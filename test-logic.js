// game-logic.js の Node ハーネス。ブラウザ不要で仕様どおりか確かめる。
var L = require('./game-logic.js');
var assert = require('assert');

function fresh() { return L.createGame(); }

// 1. エネルギー：開始20、毎秒+1、上限100
var g = fresh();
assert.strictEqual(g.energy, 20);
L.tick(g, 10);
assert.ok(Math.abs(g.energy - 30) < 0.001, 'energy after 10s: ' + g.energy);
L.tick(g, 200);
assert.strictEqual(g.energy, 100, 'energy capped at 100');

// 2. 解放スケジュール（デバッグ用一時設定）：0-10s スライムのみ、10s ゴーレム、20s ワイバーン（本番は 60s / 120s）
g = fresh();
assert.strictEqual(L.unlockedAt(g, 'slime'), true);
assert.strictEqual(L.unlockedAt(g, 'golem'), false);
assert.strictEqual(L.unlockedAt(g, 'wyvern'), false);
L.tick(g, 10);
assert.strictEqual(L.unlockedAt(g, 'golem'), true);
assert.strictEqual(L.unlockedAt(g, 'wyvern'), false);
L.tick(g, 10);
assert.strictEqual(L.unlockedAt(g, 'wyvern'), true);

// 3. 雨ステージの補正：水スライムのコスト 10→15、炎ワイバーンの威力 20→10
g = fresh();
assert.strictEqual(L.costOf(g, 'slime'), 15, 'rain slime cost');
assert.strictEqual(L.costOf(g, 'golem'), 25, 'rain golem cost unchanged');
assert.strictEqual(L.damageOf(g, 'wyvern'), 10, 'rain wyvern damage halved');
assert.strictEqual(L.damageOf(g, 'slime'), 5, 'rain slime damage unchanged');

// 4. 召喚：コストが引かれ、解放前・エネルギー不足では呼べない
g = fresh();
assert.strictEqual(L.summon(g, 'own', 'golem'), null, 'golem locked at 0s');
var m = L.summon(g, 'own', 'slime');
assert.ok(m && m.side === 'own' && m.kind === 'slime');
assert.strictEqual(g.energy, 5, '20 - rain slime cost 15 = 5');
assert.strictEqual(L.summon(g, 'own', 'slime'), null, 'not enough energy');

// 5. 経験値とレベルアップ：スライム5体で100xp → Lv2、攻撃・HP +10%
g = fresh();
L.gainXp(g, 20 * 5);
assert.strictEqual(g.level, 2, 'level 2 after 100xp');
assert.ok(Math.abs(L.buff(g) - 1.1) < 0.001);
assert.strictEqual(L.damageOf(g, 'golem'), 12 * 1.1);

// 6. 銃撃：敵モンスターに10ダメージ、倒すと経験値。射程45以内でないと当たらない
g = fresh();
var e0 = L.summon(g, 'enemy', 'slime');
assert.ok(e0);
assert.strictEqual(L.shoot(g, { type: 'monster', id: e0.id }), false, 'out of range from spawn (z=32 to z=-30)');
L.setPlayerPos(g, 0, 0); // 前線に出る
var e = e0;
g.enemyEnergy = 0; // このあと敵AIの召喚を止めて邪魔させない
L.shoot(g, { type: 'monster', id: e.id });
assert.strictEqual(e.hp, 30, 'slime 40 - gun 10');
assert.strictEqual(L.shoot(g, { type: 'monster', id: e.id }), false, 'gun cooldown blocks instant re-fire');
for (var i = 0; i < 3; i++) { L.tick(g, 0.3); L.shoot(g, { type: 'monster', id: e.id }); }
assert.strictEqual(g.monsters.length, 0, 'slime dead');
assert.strictEqual(g.xp, 20, 'xp for slime kill');
assert.strictEqual(g.kills, 1);

// 7. 本丸破壊で勝利、時間切れは本丸HPが多い方が勝ち
g = fresh();
g.base.enemy = 2.5;
assert.strictEqual(L.shoot(g, { type: 'base' }), false, 'cannot shoot enemy base from spawn');
L.setPlayerPos(g, 0, 0);
assert.strictEqual(L.shoot(g, { type: 'base' }), true, 'in range from mid-field');
assert.strictEqual(g.base.enemy, 0, 'gun does quarter damage (2.5) to base: 2.5 - 2.5 = 0');
assert.strictEqual(g.over, true);
assert.strictEqual(g.result, 'win');
g = fresh();
g.base.own = 400; g.base.enemy = 300;
L.tick(g, 30);
assert.strictEqual(g.over, true);
assert.strictEqual(g.result, 'win', 'timeout: higher base HP wins');
g = fresh();
g.base.own = 300; g.base.enemy = 300;
L.tick(g, 30);
assert.strictEqual(g.result, 'draw');

// 8. やられたら5秒後にリスポーン
g = fresh();
L.hurtPlayer(g, 200);
assert.strictEqual(g.player.alive, false);
assert.strictEqual(g.player.respawnIn, 5);
L.tick(g, 5);
assert.strictEqual(g.player.alive, true);
assert.strictEqual(g.player.hp, 100);

// 9. 敵AI：時間経過で自分も召喚してくる
g = fresh();
L.tick(g, 15); // エネルギー 20+15=35、ゴーレム解放済み（10s）
assert.ok(g.enemySummons > 0, 'enemy AI summoned: ' + g.enemySummons);
assert.ok(g.monsters.some(function (x) { return x.side === 'enemy'; }));

// 10. モンスターが本丸まで歩いて殴る（30秒フルシミュレーションが終わる）
g = fresh();
for (var t = 0; t < 30; t++) L.tick(g, 1);
assert.strictEqual(g.over, true, 'game ends within 30s, result=' + g.result);
assert.ok(['win', 'lose', 'draw'].indexOf(g.result) >= 0);

// 11. レベルは陣営ごと：自分がレベルアップしても敵モンスターは強くならない。敵が倒すと敵もレベルアップ
g = fresh();
L.gainXp(g, 100); // 自分だけ Lv2
assert.strictEqual(g.level, 2);
assert.strictEqual(g.enemyLevel, 1);
g.enemyEnergy = 100;
var em = L.summon(g, 'enemy', 'slime');
assert.ok(em);
assert.strictEqual(em.hp, 40, 'enemy slime not buffed by own level');
assert.strictEqual(em.atk, 5, 'enemy slime atk not buffed by own level');
g.energy = 100;
var om = L.summon(g, 'own', 'slime');
assert.strictEqual(om.hp, 44, 'own slime buffed by own level');
L.gainXp(g, 100, 'enemy'); // 敵も Lv2
assert.strictEqual(g.enemyLevel, 2);
var em2 = L.summon(g, 'enemy', 'slime');
assert.strictEqual(em2.hp, 44, 'enemy slime buffed by enemy level');
assert.ok(Math.abs(em2.atk - 5.5) < 0.001, 'enemy slime atk buffed by enemy level: ' + em2.atk);

// 12. デバッグ用一時設定：解放時間になったモンスターは無料で出せる
g = fresh();
assert.strictEqual(L.costOf(g, 'golem'), 25, 'golem costs 25 before unlock');
assert.strictEqual(L.costOf(g, 'wyvern'), 50, 'wyvern costs 50 before unlock');
L.tick(g, 10);
assert.strictEqual(L.costOf(g, 'golem'), 0, 'golem free after 10s');
assert.strictEqual(L.costOf(g, 'wyvern'), 50, 'wyvern still costs 50 at 10s');
L.tick(g, 10);
assert.strictEqual(L.costOf(g, 'wyvern'), 0, 'wyvern free after 20s');
assert.strictEqual(L.costOf(g, 'slime'), 15, 'slime still costs 15 (unlockAt 0, not free)');
g.energy = 0; // エネルギー0でも呼べる
var wm = L.summon(g, 'own', 'wyvern');
assert.ok(wm && wm.kind === 'wyvern', 'wyvern summoned with 0 energy after unlock');
assert.strictEqual(g.energy, 0, 'no energy spent on free wyvern');

console.log('ALL LOGIC TESTS PASSED (12 groups)');
var sg = fresh();
for (var t = 0; t < 30; t++) L.tick(sg, 1);
console.log('sample full game: result=' + sg.result +
  ' ownBase=' + Math.round(sg.base.own) + ' enemyBase=' + Math.round(sg.base.enemy) +
  ' level=' + sg.level + ' enemyLevel=' + sg.enemyLevel + ' kills=' + sg.kills);
