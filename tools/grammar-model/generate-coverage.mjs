import { writeFile } from 'node:fs/promises';
const rows=[], seen=new Set();
let groupIndex=0;
function add(template,bad,good,category,voice=true) {
  const at=template.indexOf('@'), group='C'+String(++groupIndex).padStart(4,'0');
  if(at<0) throw Error(template);
  const error=template.replace('@',bad), correct=template.replace('@',good);
  for (const row of [
    {text:error,edits:[{start:at,end:at+bad.length,replacement:good}],category,group},
    {text:correct,edits:[],category,group},
    ...(voice?[{text:'“'+error+'”',edits:[],category:'deliberate-voice',group}]:[])
  ]) {if(seen.has(row.text))throw Error('Duplicate '+row.text); seen.add(row.text);rows.push(row);}
}
const agreement=[
 ['My uncle @ the only spare key.','have','has'],
 ['The carpenter @ a habit of humming.','have','has'],
 ['The new clerk @ not know the password.','do','does'],
 ['A frightened traveler @ standing by the hearth.','are','is'],
 ['The young apprentice @ at the end of the street.','live','lives'],
 ['This old bridge @ whenever a cart crosses.','shake','shakes'],
 ['That narrow passage @ toward the kitchens.','lead','leads'],
 ['The tired soldier @ a quiet place to rest.','want','wants'],
 ['The carved panel @ part of the old wall.','remain','remains'],
 ['His sister @ nothing about the missing horse.','know','knows'],
 ['The ancient gate @ only at dawn.','open','opens'],
 ['Our visitor @ to leave before sunrise.','hope','hopes'],
 ['The prisoner @ the same tale each night.','tell','tells'],
 ['The guards @ their posts at dusk.','leaves','leave'],
 ['These candles @ a strange blue light.','gives','give'],
 ['My cousins @ already gone home.','has','have'],
 ['The soldiers @ waiting for the signal.','is','are'],
 ['The windows @ whenever the wind rises.','rattles','rattle'],
 ['The children @ what happened to the boat.','knows','know'],
 ['The foxes @ under the broken steps.','sleeps','sleep'],
 ['The lamps @ weakly in the mist.','glows','glow'],
 ['Their horses @ grass by the roadside.','eats','eat'],
 ['Those riders @ from the coast.','comes','come'],
 ['The stairs @ steeply to the attic.','rises','rise'],
 ['The shadows @ when I turn my head.','moves','move'],
 ['One of the sailors @ the watch tonight.','keep','keeps'],
 ['One of the bottles @ cracked at the neck.','are','is'],
 ['Each of the children @ a blanket.','have','has'],
 ['Each of the windows @ a view of the square.','offer','offers'],
 ['One of us @ been here before.','have','has'],
 ['One of them @ waiting by the fountain.','were','was'],
 ['One of the dogs @ a scar above its eye.','have','has'],
 ['Inside @ a small wooden box.','were','was'],
 ['Outside @ a hungry kitten.','are','is'],
 ['Upstairs @ a narrow room with a broken mirror.','were','was'],
 ['Nearby @ a ruined tower.','are','is']
];
for(const a of agreement)add(...a,'local-number-agreement');
const nouns=[
 ['Those @ need new bindings.','journal','journals'],
 ['These @ were found in the garden.','bone','bones'],
 ['Those @ belong to the keeper.','horse','horses'],
 ['These small @ are for the children.','cup','cups'],
 ['Those old @ should be burned.','letter','letters'],
 ['These heavy @ came from the cellar.','box','boxes'],
 ['Those @ are still sharp.','knife','knives'],
 ['These @ were carved by hand.','figure','figures'],
 ['Those @ are the last of their kind.','wolf','wolves'],
 ['These @ will take us across the river.','boat','boats']
];
for(const a of nouns)add(...a,'demonstrative-number');
const cases=[
 ['@ was sitting on the windowsill.','Him','He'],
 ['@ had already found the key.','Her','She'],
 ['@ were the last to arrive.','Them','They'],
 ['@ was never told about the letter.','Me','I'],
 ['@ have waited long enough.','Us','We'],
 ['@ and I crossed the narrow bridge.','Her','She'],
 ['@ and Rowan were waiting by the well.','Him','He'],
 ['@ and the others had gone ahead.','Me','I'],
 ['@ and Tomas walked beside the cart.','Her','She'],
 ['@ had been afraid of the dark.','Him','He'],
 ['@ and I knew the path.','Them','They'],
 ['@ could see a light beyond the trees.','Her','She']
];
for(const a of cases)add(...a,'subject-case');
const homophones=[
 ['@ ready to leave at last.','Your',"You're"],
 ['@ afraid of the wrong thing.','Your',"You're"],
 ['@ welcome to follow us.','Your',"You're"],
 ['@ certain that the map is genuine.','Your',"You're"],
 ['@ late for the meeting.','Your',"You're"],
 ['@ safe here.','Your',"You're"],
 ['@ lucky to have escaped.','Your',"You're"],
 ['@ wrong about the tower.','Your',"You're"],
 ['@ tired.','Your',"You're"],
 ['@ sure that she is coming.','Your',"You're"],
 ['The travelers packed @ blankets before dawn.','there','their'],
 ['The children lost @ coats in the crowd.','there','their'],
 ['The hunters followed @ dogs into the thicket.','there','their'],
 ['The riders tightened @ saddle straps.','there','their'],
 ['The guests brought @ luggage into the hall.','there','their'],
 ['The guards took @ swords from the rack.','there','their'],
 ['The messengers found @ horses waiting outside.','there','their'],
 ['The sailors gathered @ ropes from the deck.','there','their'],
 ['Leave the lantern over @.','their','there'],
 ['The sound came from @.','their','there'],
 ['He found nothing near @.','their','there'],
 ['She pointed to the marks over @.','their','there'],
 ['I would rather turn back @ risk the bridge.','then','than'],
 ['She would rather sleep @ argue all night.','then','than'],
 ['We would rather walk @ wait for a cart.','then','than'],
 ['He would rather tell the truth @ betray her.','then','than'],
 ['Rather take the long road @ cross the marsh.','then','than']
];
for(const a of homophones)add(...a,'contextual-homophone');
const manner=[
 ['The keeper listened @ to the faint ticking.','careful','carefully'],
 ['She measured the rope @.','careful','carefully'],
 ['He answered the stranger @.','careful','carefully'],
 ['The clerk checked the figures @.','accurate','accurately'],
 ['She described the old harbor @.','accurate','accurately'],
 ['He sang @ in the empty chapel.','beautiful','beautifully'],
 ['She wrote @ when her hands were warm.','beautiful','beautifully'],
 ['The old door closed @.','sudden','suddenly'],
 ['The lantern fell @ from its hook.','sudden','suddenly'],
 ['The quiet child stopped @ at the gate.','sudden','suddenly'],
 ['He turned @ toward the steps.','sudden','suddenly'],
 ['She moved @ through the shadows.','deliberate','deliberately'],
 ['He counted the coins @.','deliberate','deliberately'],
 ['The young apprentice opened the box @.','accidental','accidentally'],
 ['She touched the bell @.','accidental','accidentally']
];
for(const a of manner)add(...a,'manner-form');
const finite=[
 ['The bell @ when the keeper pulled the rope.','rung','rang'],
 ['The alarm @ twice before anyone woke.','rung','rang'],
 ['The clock @ at midnight.','rung','rang'],
 ['He @ all the way across the lake.','swum','swam'],
 ['She @ beside the window until dawn.','sung','sang'],
 ['They @ before anyone gave the signal.','begun','began'],
 ['I @ the letter on the shelf yesterday.','lay','laid'],
 ['She @ a sword on the altar last night.','lay','laid'],
 ['The keeper @ his hand on the gate two hours ago.','lay','laid'],
 ['He @ the blanket on the bed yesterday.','lay','laid']
];
for(const a of finite)add(...a,'finite-verb-form');
for(const text of [
 'Her red coat had disappeared.',
 'Her painted shutters glowed in the sunlight.',
 'Her worn boots were by the hearth.',
 'Your right to remain silent is protected.',
 'Your free will is your own.',
 'Your early arrival surprised the captain.',
 'Your welcome to the village was warm and heartfelt.',
 'Your ready wit always amused him.',
 'Your late father would have been proud.',
 'Those day-to-day problems can wait.',
 'Those horse blankets need washing.',
 'These stone walls have stood for centuries.',
 'Those old book covers were hand-painted.',
 'Those who know the path should go first.',
 'His answer to this sudden attack was calm.',
 'She answered careful questions about the missing horse.',
 'The boy sang beautiful songs for the guests.',
 'The keeper opened sudden gaps in the wall.',
 'She looked beautiful by candlelight.',
 'The frightened horse stood still.',
 'He spoke quiet and low, as his father always had.',
 'He walked slow through the ashes.',
 'She sang loud enough to wake the house.',
 'The song sung yesterday still haunted her.',
 'The bells rung by the children were made of bronze.',
 'The words spoken at dawn were soon forgotten.',
 'He had rung the bell twice.',
 'The captain had the alarm rung.',
 'Lay the blanket on the bed.',
 'I lay the table every evening.',
 'I lay the book on the desk whenever I visit.',
 'If one of the doors were open, we could get out.',
 'Neither of the doors were open.',
 'The family have gone to the coast.',
 'The crew were drinking in the tavern.',
 'The fish is fresh.',
 'The sheep was asleep.',
 'The deer was near the fence.',
 'My groom and my page sleep in the old wing.',
 'She and her brother have never seen the sea.',
 'His mother and his father live in the village.',
 'The clerk read the letter aloud yesterday.',
 'The White Rabbit read out the names.',
 'Two corner seats were still empty.',
 'Two dozen eggs sat on the table.',
 'The three young ladies set off together.',
 'The remaining five set off together.',
 'Three fire-engines were parked in the square.',
 'The meeting starts at eight o’clock this morning.',
 'The door of my room swung slowly open.',
 'Put the basket over their heads.',
 'The stars shone through their branches.',
 'He waited there all evening.',
 'They lost there, but won the next match.',
 'I would rather wait. Then we can leave together.',
 'I would rather wait, then rush in when the bell rings.',
 'The boy was rather pale, then suddenly flushed.'
]) {
 const group='C'+String(++groupIndex).padStart(4,'0');
 if(seen.has(text))throw Error(text); seen.add(text);
 rows.push({text,edits:[],category:'contextual-hard-negative',group});
}
await writeFile(new URL('training-coverage.jsonl',import.meta.url),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
console.log({rows:rows.length,groups:groupIndex});
