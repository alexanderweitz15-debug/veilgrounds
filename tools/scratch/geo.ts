import { loadMap } from '../../src/sim/map';
import { laneLength } from '../../src/ai/perception/waves';
const m = loadMap();
const pts = m.sides[0].lanes.mid;
console.log(JSON.stringify(pts), laneLength(pts), JSON.stringify(m.sides[0].towers.mid), JSON.stringify(m.sides[1].towers.mid), JSON.stringify(m.sides[0].fountain));
