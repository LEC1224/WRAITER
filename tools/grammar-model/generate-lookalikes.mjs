import { writeFile } from 'node:fs/promises';

// Target the contextual lookalikes that actually reach the scoring model.
// Keep each matched set in one validation fold.
const rows = [];
let group = 0;
const add = (template, original, replacement, category, includeDialogue = false) => {
  const id = 'P' + ++group;
  const start = template.indexOf('@');
  const replace = value => template.replace('@', value);
  rows.push({ text: replace(original), edits: [{ start, end: start + original.length, replacement }], category, group: id });
  rows.push({ text: replace(replacement), edits: [], category, group: id });
  if (includeDialogue) rows.push({ text: '“' + replace(original) + '”', edits: [], category: 'voice', group: id });
};

for (const [phrase, original, replacement, tail] of [
  ['The lamps along the platform', 'was', 'were', 'lit by dusk.'],
  ['The keys inside the cabinet', 'is', 'are', 'not for us.'],
  ['The shutters behind the table', 'has', 'have', 'been shut all winter.'],
  ['The guards beside the arch', 'does', 'do', 'not know our names.'],
  ['The branches over the roof', 'brushes', 'brush', 'against the tiles.'],
  ['The bells in the tower', 'rings', 'ring', 'at noon.'],
  ['The ropes on the boat', 'hangs', 'hang', 'into the water.'],
  ['The letters under the door', 'lies', 'lie', 'where they fell.'],
  ['The dogs near the wagon', 'sits', 'sit', 'perfectly still.'],
  ['The stairs by the kitchen door', 'creaks', 'creak', 'in cold weather.'],
  ['The box of letters', 'are', 'is', 'too heavy to carry.'],
  ['The sailor with the maps', 'have', 'has', 'a seal on each one.'],
  ['The lock on the gates', 'do', 'does', 'not open from this side.'],
  ['The end of the stairs', 'lead', 'leads', 'straight to the cellar.'],
  ['The trail beyond the fields', 'turn', 'turns', 'abruptly to the west.'],
  ['The tower near the cliffs', 'lean', 'leans', 'toward the sea.'],
  ['The chest with the coats', 'stand', 'stands', 'at the foot of the bed.'],
  ['The drawer beside the needles', 'open', 'opens', 'only halfway.'],
  ['The windows along the corridor', 'rattles', 'rattle', 'whenever a cart passes.'],
  ['The bottles near the cupboard', 'was', 'were', 'already empty.'],
  ['The wall under the windows', 'shake', 'shakes', 'when the bell rings.'],
  ['The candle between the mirrors', 'flicker', 'flickers', 'in the draught.'],
  ['The oars inside the boat', 'was', 'were', 'gone by dawn.'],
  ['The hinges on the chest', 'scrapes', 'scrape', 'when the lid moves.'],
  ['The path through the garden', 'lead', 'leads', 'to the fountain.'],
  ['The messenger at the gate', 'have', 'has', 'already met the captain.']
]) add(phrase + ' @ ' + tail, original, replacement, 'subject-number', true);

for (const [template, original, replacement] of [
  ['I had already @ half the bread.', 'ate', 'eaten'],
  ['We had never @ the captain leave so early.', 'saw', 'seen'],
  ['She hasn’t @ the last chapter yet.', 'wrote', 'written'],
  ['They had just @ when the rope snapped.', 'spoke', 'spoken'],
  ['He had certainly @ the message by then.', 'gave', 'given'],
  ['He had @ long before the sky cleared.', 'went', 'gone'],
  ['They hadn’t @ a lantern.', 'took', 'taken'],
  ['I had finally @ the ice.', 'broke', 'broken'],
  ['You should probably @ more slowly.', 'ran', 'run'],
  ['He did not @ the king about the map.', 'told', 'tell'],
  ['We can still @ the first bridge.', 'saw', 'see'],
  ['She might @ a little if we asked.', 'drank', 'drink'],
  ['He didn’t @ any farther that night.', 'went', 'go'],
  ['Could you @ this letter for me?', 'wrote', 'write'],
  ['We could finally @ to the keeper.', 'spoke', 'speak'],
  ['You must never @ the seal.', 'broke', 'break'],
  ['I wanted to @ beside the well.', 'waited', 'wait'],
  ['She paused to @ the window.', 'closed', 'close'],
  ['The keeper bent to @ the bell.', 'touched', 'touch'],
  ['We turned to @ the girl pass.', 'watched', 'watch'],
  ['He was too tired to @ any farther.', 'walked', 'walk'],
  ['I had no wish to @ the captain.', 'helped', 'help'],
  ['She took a moment to @ what she had seen.', 'explained', 'explain'],
  ['He lifted the lamp to @ the corridor.', 'lighted', 'light']
]) add(template, original, replacement, 'verb-form', true);

for (const [template, original, replacement] of [
  ['They offered three practical @ about the ropes.', 'advices', 'pieces of advice'],
  ['Her several useful @ were all we had to go on.', 'informations', 'pieces of information'],
  ['We salvaged three old @ from the house.', 'furnitures', 'pieces of furniture'],
  ['The cart carried two spare @ for the dig.', 'equipments', 'pieces of equipment'],
  ['I wrote down some @ before we left.', 'advices', 'advice'],
  ['We brought a few @ along with the maps.', 'luggages', 'pieces of luggage'],
  ['They had two small @ to unload.', 'baggages', 'pieces of baggage'],
  ['All the @ she left us fitted in one envelope.', 'informations', 'information'],
  ['The innkeeper gave us many @ on staying warm.', 'advices', 'pieces of advice'],
  ['They left four @ in the barn.', 'horse', 'horses'],
  ['Several @ on the deck were splintered.', 'bench', 'benches'],
  ['We found three spare @ in the box.', 'key', 'keys'],
  ['A few broken @ hung from the west wall.', 'chain', 'chains'],
  ['The drawer held seven @ and a letter.', 'coin', 'coins'],
  ['There were eight @ in the back row.', 'chair', 'chairs']
]) add(template, original, replacement, 'noun-count', true);

for (const text of [
  'We listened to recorded voices from the attic.',
  'The narrow trail led to packed earth and weeds.',
  'The key was fitted to warped wood.',
  'The wing was given over to retired officers.',
  'She returned to closed doors and dark windows.',
  'The same code applies to borrowed books.',
  'He rubbed some oil into the wood to finish the carved chairs.',
  'The path led to abandoned boats near the river.',
  'The river had turned the field to flooded pasture.',
  'The next steps are up to elected officials.',
  'To burned fields and ruined houses they returned.',
  'She would saw through the rope with her knife.',
  'The worker could saw the oak into planks.',
  'He does saw when the shop is quiet.',
  'She was going to saw the timber before lunch.',
  'A clear path led to fallen branches.',
  'The new law applies to stolen goods.',
  'We spoke to retired captains, all of them cheerful.',
  'She was accustomed to close calls.',
  'The hall was hung with several chain links.',
  'Several lamp makers rented the upper floor.',
  'She bought four coat hangers.',
  'Two clock faces showed different times.',
]) {
  // Deliberate negatives include verbal homographs (saw, close), plural
  // noun compounds, and specialized senses the checker should not rewrite.
  rows.push({ text, edits: [], category: 'context-lookalike', group: 'P' + ++group });
}
await writeFile(new URL('training-lookalikes.jsonl', import.meta.url), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
