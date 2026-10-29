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
console.log(pass, 'pass', fail, 'fail');
t('in Kahf, recite Mulk → 67', show(E.locate('تبارك الذي بيده الملك وهو على كل شيء قدير', E.first(18,45), 18, 'lost')), '67:1');
t('in Baqarah, recite Fatiha → 1', show(E.locate('الحمد لله رب العالمين الرحمن الرحيم', E.first(2,20), 2, 'lost')), '1:3');
t('in Kahf, later Kahf ayah → 18:10', show(E.locate('إذ أوى الفتية إلى الكهف فقالوا ربنا آتنا من لدنك رحمة', E.first(18,1), 18, 'lost')), '18:10');
if (fail) process.exit(1);
