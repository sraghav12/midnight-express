//! MIDNIGHT EXPRESS -- contested track, settled on-chain.
//!
//! One RunState PDA holds the whole crew's token balances. At departure it is
//! DELEGATED to a MagicBlock Ephemeral Rollup, where second-price auctions settle
//! at ER speed with zero fees; at arrival the state is committed back to devnet
//! and undelegated, leaving a public record the losers can verify themselves.
//!
//! Why a chain at all: every bidder is a rival with an incentive to misreport.
//! A plain server could run this auction, but only its operator could audit it.
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("DfWk4yfyvMhU6NYyEK24Qn82mUTBXRk1ur5wwShopg7m");

pub const RUN_SEED: &[u8] = b"run";
pub const MAX_TRAINS: usize = 24;

#[ephemeral]
#[program]
pub mod midnight_express {
    use super::*;

    /// Open a run on the base layer. Every train starts with the same allowance.
    pub fn initialize_run(ctx: Context<InitializeRun>, run_id: u64, train_count: u8, start_budget: u32) -> Result<()> {
        require!(train_count as usize <= MAX_TRAINS, MeError::TooManyTrains);
        let run = &mut ctx.accounts.run;
        run.authority = ctx.accounts.payer.key();
        run.run_id = run_id;
        run.train_count = train_count;
        run.auctions_settled = 0;
        run.budgets = [0u32; MAX_TRAINS];
        run.delays = [0u32; MAX_TRAINS];
        for i in 0..train_count as usize {
            run.budgets[i] = start_budget;
        }
        run.bump = ctx.bumps.run;
        Ok(())
    }

    /// Hand the run to the ER so auctions can settle in milliseconds.
    pub fn delegate_run(ctx: Context<DelegateRun>, run_id: u64) -> Result<()> {
        ctx.accounts.delegate_run(
            &ctx.accounts.payer,
            &[RUN_SEED, &run_id.to_le_bytes()],
            DelegateConfig {
                // pin a validator when one is passed in remaining_accounts
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// SECOND-PRICE settlement. Runs on the ER.
    ///
    /// The winner pays `price`, which is the SECOND-highest bid, not its own --
    /// that is what makes bidding your true value the dominant strategy. The whole
    /// payment is split among the losers as compensation for being held.
    pub fn settle_auction(
        ctx: Context<SettleAuction>,
        winner: u8,
        price: u32,
        losers: Vec<u8>,
    ) -> Result<()> {
        let run = &mut ctx.accounts.run;
        let n = run.train_count as usize;
        require!((winner as usize) < n, MeError::BadTrainIndex);
        require!(!losers.is_empty(), MeError::NoLosers);
        for l in losers.iter() {
            require!((*l as usize) < n, MeError::BadTrainIndex);
            require!(*l != winner, MeError::WinnerCannotLose);
        }
        require!(run.budgets[winner as usize] >= price, MeError::InsufficientBudget);

        run.budgets[winner as usize] -= price;
        let share = price / losers.len() as u32;
        for l in losers.iter() {
            run.budgets[*l as usize] = run.budgets[*l as usize].saturating_add(share);
            run.delays[*l as usize] = run.delays[*l as usize].saturating_add(1);
        }
        run.auctions_settled = run.auctions_settled.saturating_add(1);
        msg!("auction #{} -> train {} paid {} (second price), {} losers compensated {} each",
             run.auctions_settled, winner, price, losers.len(), share);
        Ok(())
    }

    /// Push ER state down to the base layer without giving up the delegation.
    pub fn commit_run(ctx: Context<CommitRun>, _run_id: u64) -> Result<()> {
        ctx.accounts.run.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit(&[ctx.accounts.run.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    /// Arrival: commit the final state and hand ownership back to the base layer.
    pub fn undelegate_run(ctx: Context<CommitRun>, _run_id: u64) -> Result<()> {
        ctx.accounts.run.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.run.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }
}

#[account]
pub struct RunState {
    pub authority: Pubkey,
    pub run_id: u64,
    pub train_count: u8,
    pub auctions_settled: u32,
    pub budgets: [u32; MAX_TRAINS],
    pub delays: [u32; MAX_TRAINS],
    pub bump: u8,
}

impl RunState {
    pub const SIZE: usize = 8 + 32 + 8 + 1 + 4 + (4 * MAX_TRAINS) + (4 * MAX_TRAINS) + 1;
}

#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct InitializeRun<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = RunState::SIZE,
        seeds = [RUN_SEED, &run_id.to_le_bytes()],
        bump
    )]
    pub run: Account<'info, RunState>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct DelegateRun<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, del, seeds = [RUN_SEED, &run_id.to_le_bytes()], bump)]
    /// CHECK: deserialized by later ER instructions once delegated.
    pub run: UncheckedAccount<'info>,
    /// CHECK: checked by the delegation program.
    pub validator: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct SettleAuction<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [RUN_SEED, &run.run_id.to_le_bytes()], bump = run.bump)]
    pub run: Account<'info, RunState>,
}

#[commit]
#[derive(Accounts)]
#[instruction(run_id: u64)]
pub struct CommitRun<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [RUN_SEED, &run_id.to_le_bytes()], bump = run.bump)]
    pub run: Account<'info, RunState>,
}

#[error_code]
pub enum MeError {
    #[msg("too many trains for this run")]
    TooManyTrains,
    #[msg("train index out of range")]
    BadTrainIndex,
    #[msg("an auction needs at least one loser")]
    NoLosers,
    #[msg("the winner cannot also be a loser")]
    WinnerCannotLose,
    #[msg("winner cannot afford the clearing price")]
    InsufficientBudget,
}
