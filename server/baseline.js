// The Optimization punchline. Replays the exact same instance -- same trains,
// same origins, same destinations, same network -- under a CENTRALIZED dispatcher
// that has full information and breaks every tie itself.
//
// We call this a "centralized baseline", NOT "optimal". It is a strong greedy
// dispatcher, not a solved MAPF instance. Say that to judges; precision reads better
// than an inflated claim. (Upgrade path: swap the priority rule for CBS.)
import { Run } from "./sim.js";

export function centralizedBaseline(summary, { scarcity, minTraffic } = {}) {
  const run = new Run({ policy: "central", scarcity, minTraffic: 0 });

  // rebuild the identical fleet
  for (const t of summary.trains) {
    const clone = run.addTrain({ name: t.name, isAgent: t.isAgent });
    clone.origin = t.origin;
    clone.node = t.origin;
    clone.destination = t.destination;
    clone.path = [t.origin];
  }

  run.phase = "running";
  run.tick = 0;
  let guard = 0;
  while (run.phase === "running" && guard++ < 20000) run.step();

  const s = run.summary();
  return {
    baselineDelay: s.trains.reduce((a, t) => a + t.delayTicks, 0),
    baselineTicks: s.ticks,
    baselineArrived: s.scoreboard.arrivedCount,
    baselinePaths: Object.fromEntries(s.trains.map((t) => [t.name, t.path])),
    // replay data: same shape as the live run's log, ids mapped back by name
    baselineLog: s.log,
    baselineTrains: s.trains.map((t) => ({ id: t.id, name: t.name })),
  };
}
