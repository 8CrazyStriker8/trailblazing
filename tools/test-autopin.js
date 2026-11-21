// node tools/test-autopin.js [roadbook.json]: what the auto-pins read in a roadbook's notes
const { rrPlaceRefs, rrNameSim } = require('../src/autopin.js');
const f = process.argv[2]; if (!f) { console.log('usage: node tools/test-autopin.js roadbook.json'); process.exit(1); }
const rb = JSON.parse(require('fs').readFileSync(f, 'utf8'));
for (const s of rb.secs || [{ boxes: rb.boxes }]) s.boxes.forEach((b, i) => {
  const r = rrPlaceRefs(b.notes);
  if (r.pins.length || r.avoid.length) console.log(String(i + 1).padStart(3), r.pins.map(p => `${p.kind}:${p.name}`).join(' | ').padEnd(60), r.avoid.length ? 'AVOID ' + r.avoid.join(', ') : '');
});
const pairs = [['Sidi Alla Tizi', 'Sidi Allal Tazi'], ['Moulay Bousselam', 'Moulay Bousselham'], ['Meknes West', 'Meknès Ouest'], ['Ait Oufala', 'Aït Oufella'], ['Kenitra', 'Péage de Kénitra'], ['Nasra', "Aire de service M'Nasra"], ['Tiflet', 'Tiflet تيفلت'], ['Larache 1', 'Larache'], ['Tanger', 'Tétouan']];
for (const [a, b] of pairs) console.log('sim', a, '~', b, rrNameSim(a, b).toFixed(2));
