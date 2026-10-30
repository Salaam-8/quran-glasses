const E = require('../src/engine.js');
const raw = require('../data/quran.json');
const Q = raw.map(s => [s.name, s.verses.map(v => v.text)]);
E.build(Q);
const show = i => i == null ? 'NONE' : `${E.pos(i).s}:${E.pos(i).a}`;
let pass = 0, fail = 0;
function t(desc, got, want) { const ok = got === want; ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + desc + ' → ' + got + (ok ? '' : ' (want ' + want + ')')); }

// local tracking inside Fatiha (plain spelling as a recogniser would output)
let c = E.start(1);
t('fatiha 1:2', show(E.locate('الحمد لله رب العالمين', c, 1, 'local')), '1:2');
t('fatiha 1:4', show(E.locate('الرحمن الرحيم مالك يوم الدين', E.first(1, 3), 1, 'local')), '1:4');
t('fatiha 1:7 w/ error', show(E.locate('صراط الذين انعمت عليهم غير المغضوب', E.first(1, 6), 1, 'local')), '1:7');
// baqarah with alef/hamza/ta-marbuta differences
t('baqarah 2:3', show(E.locate('الذين يؤمنون بالغيب ويقيمون الصلاة', E.first(2, 2), 2, 'local')), '2:3');
t('baqarah 2:5', show(E.locate('أولئك على هدى من ربهم وأولئك هم المفلحون', E.first(2, 4), 2, 'local')), '2:5');
// interim with a cut-off last word
t('interim cut', show(E.locate('ذلك الكتاب لا ريب فيه هدى للمت', E.first(2, 2), 2, 'local')), '2:2');
// fast path: short interim results move word by word
t('interim one word at cursor', show(E.locate('الحمد', E.first(1, 2), 1, 'local')), '1:2');
t('interim next word', show(E.locate('لله', E.first(1, 2) + 1, 1, 'local')), '1:2');
t('interim two words', show(E.locate('رب العالمين', E.first(1, 2) + 1, 1, 'local')), '1:2');
t('interim one unexpected word', show(E.locate('كتاب', E.first(1, 2), 1, 'local')), 'NONE');
t('interim one word lookahead of 3 only', show(E.locate('الدين', E.first(1, 2), 1, 'local')), 'NONE');
// n-best: keep the alternative that fits the text near the cursor
t('best alternative', E.bestAlternative(['الحمد لك يا رب', 'الحمد لله رب العالمين', 'احمد الله'], E.first(1, 2), 1), 1);
t('best alternative keeps first on tie', E.bestAlternative(['الحمد لله رب العالمين', 'الحمد لله رب العالمين'], E.first(1, 2), 1), 0);
t('far noisy echo refused', show(E.locate('من الذين في', E.first(2, 1), 2, 'local')), 'NONE');

// global find from cold start
t('global kahf 18:1', show(E.locate('الحمد لله الذي أنزل على عبده الكتاب ولم يجعل له عوجا', 0, 1, 'lost')), '18:1');
t('global yasin 36:2', show(E.locate('يس والقرآن الحكيم إنك لمن المرسلين', 0, 1, 'lost')), '36:3');
t('global mulk 67:1', show(E.locate('تبارك الذي بيده الملك وهو على كل شيء قدير', 0, 1, 'lost')), '67:1');
t('global ikhlas', show(E.locate('قل هو الله أحد الله الصمد لم يلد ولم يولد', 0, 1, 'lost')), '112:3');
// ambiguity guards
t('ambiguous 2:255 vs 3:2 refused', show(E.locate('الله لا إله إلا هو الحي القيوم', 0, 1, 'lost')), 'NONE');
t('kursi with more words', show(E.locate('الحي القيوم لا تأخذه سنة ولا نوم له ما في السماوات', 0, 1, 'lost')), '2:255');
t('basmala alone ignored', show(E.locate('بسم الله الرحمن الرحيم', 0, 2, 'lost')), 'NONE');
t('rahman repeat refused', show(E.locate('فبأي آلاء ربكما تكذبان', 0, 55, 'lost')), 'NONE');
// surah-wide search (lost inside current surah)
t('surah-wide baqarah 2:285', show(E.locate('آمن الرسول بما أنزل إليه من ربه والمؤمنون', E.start(2), 2, 'lost')), '2:285');
// noise should not match locally
t('noise local', show(E.locate('سبحان ربي العظيم سبحان ربي العظيم', E.first(2, 10), 2, 'local')), 'NONE');
// voice commands
t('cmd الكهف', E.surahCommand('سورة الكهف'), 18);
t('cmd البقره', E.surahCommand('افتح سوره البقره'), 2);
t('cmd يس', E.surahCommand('سورة يس'), 36);
t('cmd آل عمران', E.surahCommand('سورة آل عمران'), 3);
t('cmd الملك', E.surahCommand('سورة الملك'), 67);
t('cmd مريم', E.surahCommand('سورة مريم'), 19);
t('An-Nur 24:1 not a command', E.surahCommand('سورة أنزلناها وفرضناها'), null);
let T = Date.now(); for (let k = 0; k < 5; k++) E.locate('تبارك الذي بيده الملك وهو على كل شيء قدير', 0, 1, 'lost');
console.log('global search ms:', (Date.now() - T) / 5);
t('in Kahf, recite Mulk → 67', show(E.locate('تبارك الذي بيده الملك وهو على كل شيء قدير', E.first(18,45), 18, 'lost')), '67:1');
t('in Baqarah, recite Fatiha → 1', show(E.locate('الحمد لله رب العالمين الرحمن الرحيم', E.first(2,20), 2, 'lost')), '1:3');
t('in Kahf, later Kahf ayah → 18:10', show(E.locate('إذ أوى الفتية إلى الكهف فقالوا ربنا آتنا من لدنك رحمة', E.first(18,1), 18, 'lost')), '18:10');
// search scope
const K45 = E.first(18, 45);
t('scope surah: Mulk from Kahf refused', show(E.locate('تبارك الذي بيده الملك وهو على كل شيء قدير', K45, 18, 'lost', { scope: 'surah' })), 'NONE');
t('scope surah: later Kahf ayah found', show(E.locate('إذ أوى الفتية إلى الكهف فقالوا ربنا آتنا من لدنك رحمة', E.first(18, 1), 18, 'lost', { scope: 'surah' })), '18:10');
t('scope next: Maryam from Kahf found', show(E.locate('ذكر رحمت ربك عبده زكريا إذ نادى ربه نداء خفيا', K45, 18, 'lost', { scope: 'next' })), '19:3');
t('scope next: Mulk from Kahf refused', show(E.locate('تبارك الذي بيده الملك وهو على كل شيء قدير', K45, 18, 'lost', { scope: 'next' })), 'NONE');
t('scope all: Mulk from Kahf found', show(E.locate('تبارك الذي بيده الملك وهو على كل شيء قدير', K45, 18, 'lost', { scope: 'all' })), '67:1');
// far-jump gate: more than 10 ayahs away needs two consecutive finals
{
  const g = E.jumpGate(10), cur = E.first(2, 5), near = E.first(2, 12), far = E.first(2, 30), far2 = E.first(2, 31), other = E.first(67, 1);
  t('gate: no position yet passes', g.accept(far, -1), far);
  t('gate: within 10 ayahs passes', g.accept(near, cur), near);
  t('gate: far jump held once', g.accept(far, cur), null);
  t('gate: same far place twice accepted', g.accept(far2, cur), far2);
  t('gate: other surah held once', g.accept(other, cur), null);
  t('gate: different far place resets', g.accept(far, cur), null);
  t('gate: confirmed after reset', g.accept(far, cur), far);
  t('gate: far() reports distance', JSON.stringify([g.far(near, cur), g.far(far, cur), g.far(other, cur)]), '[false,true,true]');
}

console.log(pass, 'pass', fail, 'fail');
if (fail) process.exit(1);
