// FPS×戦略 試作版のコアロジック（ブラウザ依存なし）。
// 数字は全部仮置き。2026-11-23 11:14 JST に送った仕様案と同じ値。
// Node でも読めるし、ブラウザでは window.FPSLogic になる。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.FPSLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CONFIG = {
    duration: 30,             // デバッグ用一時設定：制限時間 30秒（本番は 180秒＝3分に戻す）
    energyStart: 20, energyRegen: 1, energyMax: 100,
    baseHp: 500, playerHp: 100, gunDamage: 10, gunCooldown: 0.3, gunRange: 45, respawnDelay: 5,
    unlockAt: { slime: 0, golem: 10, wyvern: 20 }, // デバッグ用一時設定：0-10s スライムのみ、10-20s ゴーレム追加、20-30s ワイバーン追加（本番は 60s / 120s）
    debugFreeAfterUnlock: true, // デバッグ用一時設定：解放時間になったモンスターは無料で出せる（本番は false に戻す）
    cost: { slime: 10, golem: 25, wyvern: 50 },
    xpPerKill: { slime: 20, golem: 40, wyvern: 80 },
    xpNext: 100,              // レベルアップに必要な経験値（以降 +50ずつ）
    levelBuff: 0.10,          // Lvごとに攻撃・HP +10%
    // ステージ「雨」の補正（大輝の例のまま）
    stage: 'rain',
    rainCostMult: { slime: 1.5 },   // 水スライムの生成コスト 1.5倍
    rainDamageMult: { wyvern: 0.5 } // 炎ワイバーンの威力 半減
  };

  // モンスターの素の性能。kind は slime / golem / wyvern の3種だけ。
  var MONSTER_STATS = {
    slime:  { hp: 40,  atk: 5,  speed: 3.0, range: 2.2, element: 'water' },
    golem:  { hp: 120, atk: 12, speed: 1.5, range: 2.5, element: 'earth' },
    wyvern: { hp: 80,  atk: 20, speed: 4.0, range: 3.0, element: 'fire' }
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function createGame() {
    return {
      time: 0, over: false, result: null, // 'win' | 'lose' | 'draw'
      stage: CONFIG.stage,
      energy: CONFIG.energyStart,
      enemyEnergy: CONFIG.energyStart,
      level: 1, xp: 0, xpNext: CONFIG.xpNext,
      enemyLevel: 1, enemyXp: 0, enemyXpNext: CONFIG.xpNext,
      player: { hp: CONFIG.playerHp, alive: true, respawnIn: 0, cool: 0, x: 0, z: 32 },
      base: { own: CONFIG.baseHp, enemy: CONFIG.baseHp },
      monsters: [], // {id, kind, side:'own'|'enemy', hp, maxHp, atk, x, z, cool}
      nextId: 1,
      kills: 0, summons: 0, enemySummons: 0,
      log: []
    };
  }

  // レベル補正は陣営ごと。自分のレベルアップで敵モンスターまで強くならない。
  function buff(state, side) {
    var lv = side === 'enemy' ? state.enemyLevel : state.level;
    return 1 + (lv - 1) * CONFIG.levelBuff;
  }

  function costOf(state, kind) {
    // デバッグ用一時設定：解放時間になったモンスターは無料。スライムは
    // unlockAt が 0 なので対象外（コスト15のまま）。ゴーレムは10秒後から、
    // ワイバーンは20秒後から無料。canSummon・summon・敵AIは costOf を使うので、
    // そのまま無料で呼べるようになる。
    if (CONFIG.debugFreeAfterUnlock && CONFIG.unlockAt[kind] > 0 && state.time >= CONFIG.unlockAt[kind]) return 0;
    var c = CONFIG.cost[kind];
    if (state.stage === 'rain' && CONFIG.rainCostMult[kind]) c = Math.ceil(c * CONFIG.rainCostMult[kind]);
    return c;
  }

  function damageOf(state, kind, side) {
    var d = MONSTER_STATS[kind].atk * buff(state, side);
    if (state.stage === 'rain' && CONFIG.rainDamageMult[kind]) d = d * CONFIG.rainDamageMult[kind];
    return d;
  }

  function unlockedAt(state, kind) { return state.time >= CONFIG.unlockAt[kind]; }

  function canSummon(state, kind) {
    return !state.over && unlockedAt(state, kind) && state.energy >= costOf(state, kind);
  }

  function summon(state, side, kind) {
    if (side === 'own') {
      if (!canSummon(state, kind)) return null;
      state.energy -= costOf(state, kind);
      state.summons++;
    } else {
      if (state.time < CONFIG.unlockAt[kind] || state.enemyEnergy < costOf(state, kind)) return null;
      state.enemyEnergy -= costOf(state, kind);
      state.enemySummons++;
    }
    var s = MONSTER_STATS[kind];
    var m = {
      id: state.nextId++, kind: kind, side: side,
      hp: Math.round(s.hp * buff(state, side)), maxHp: Math.round(s.hp * buff(state, side)),
      atk: damageOf(state, kind, side),
      x: side === 'own' ? (Math.random() * 6 - 3) : (Math.random() * 6 - 3),
      z: side === 'own' ? 30 : -30,
      cool: 0
    };
    state.monsters.push(m);
    return m;
  }

  // 経験値は倒した側の陣営に入る。side を省くと自軍。
  function gainXp(state, amount, side) {
    if (side === 'enemy') {
      state.enemyXp += amount;
      while (state.enemyXp >= state.enemyXpNext) {
        state.enemyXp -= state.enemyXpNext;
        state.enemyLevel++;
        state.enemyXpNext = CONFIG.xpNext + (state.enemyLevel - 1) * 50;
        state.log.push('敵もレベルアップ！ 敵Lv' + state.enemyLevel + '（攻撃・HP +10%）');
      }
      return;
    }
    state.xp += amount;
    while (state.xp >= state.xpNext) {
      state.xp -= state.xpNext;
      state.level++;
      state.xpNext = CONFIG.xpNext + (state.level - 1) * 50;
      state.log.push('レベルアップ！ Lv' + state.level + '（攻撃・HP +10%）');
    }
  }

  // モンスターが倒れたときの処理。killerSide が倒した側。
  function killMonster(state, monster, killerSide) {
    state.monsters = state.monsters.filter(function (m) { return m.id !== monster.id; });
    if (killerSide === 'own') {
      state.kills++;
      gainXp(state, CONFIG.xpPerKill[monster.kind]);
    } else if (killerSide === 'enemy') {
      gainXp(state, CONFIG.xpPerKill[monster.kind], 'enemy');
    }
  }

  // 1フレーム分の進行。dt は秒。敵AIの召喚もここでやる。
  function tick(state, dt) {
    if (state.over) return;
    state.time += dt;
    state.energy = Math.min(CONFIG.energyMax, state.energy + CONFIG.energyRegen * dt);
    state.enemyEnergy = Math.min(CONFIG.energyMax, state.enemyEnergy + CONFIG.energyRegen * dt);
    if (state.player.cool > 0) state.player.cool -= dt;

    // プレイヤーのリスポーン
    if (!state.player.alive) {
      state.player.respawnIn -= dt;
      if (state.player.respawnIn <= 0) {
        state.player.alive = true;
        state.player.hp = CONFIG.playerHp;
        state.log.push('リスポーンしたよ（自軍本丸近く）');
      }
    }

    // 敵AI：ためたエネルギーで、解放済みの一番強いモンスターを呼ぶ
    if (state.enemyEnergy >= costOf(state, 'wyvern') && unlockedAt(state, 'wyvern')) summon(state, 'enemy', 'wyvern');
    else if (state.enemyEnergy >= costOf(state, 'golem') && unlockedAt(state, 'golem')) summon(state, 'enemy', 'golem');
    else if (state.enemyEnergy >= costOf(state, 'slime')) summon(state, 'enemy', 'slime');

    // モンスターの移動と攻撃
    var dead = [];
    state.monsters.forEach(function (m) {
      m.cool -= dt;
      var targetZ = m.side === 'own' ? -38 : 38; // 敵の本丸へ進む
      var dir = targetZ > m.z ? 1 : -1;
      // 目の前に敵モンスターがいたら止まって殴る
      var foe = null, best = 1e9;
      state.monsters.forEach(function (o) {
        if (o.side === m.side) return;
        var d = Math.abs(o.z - m.z) + Math.abs(o.x - m.x);
        if (d < best) { best = d; foe = o; }
      });
      var s = MONSTER_STATS[m.kind];
      if (foe && best <= s.range) {
        if (m.cool <= 0) {
          foe.hp -= m.atk;
          m.cool = 1;
          if (foe.hp <= 0) dead.push({ m: foe, killer: m.side });
        }
      } else if (Math.abs(targetZ - m.z) <= s.range) {
        // 本丸に到着したら本丸を殴る
        if (m.cool <= 0) {
          if (m.side === 'own') state.base.enemy -= m.atk; else state.base.own -= m.atk;
          m.cool = 1;
        }
      } else {
        m.z += dir * s.speed * dt;
      }
    });
    dead.forEach(function (d) { killMonster(state, d.m, d.killer); });

    // 勝敗判定
    if (state.base.enemy <= 0) { state.over = true; state.result = 'win'; }
    else if (state.base.own <= 0) { state.over = true; state.result = 'lose'; }
    else if (state.time >= CONFIG.duration) {
      state.over = true;
      state.result = state.base.own === state.base.enemy ? 'draw'
        : (state.base.own > state.base.enemy ? 'win' : 'lose'); // 時間切れは本丸HPが多い方が勝ち
    }
  }

  function setPlayerPos(state, x, z) { state.player.x = x; state.player.z = z; }

  // プレイヤーの銃撃。target は {type:'monster', id} か {type:'base'}。
  // 射程45以内でないと当たらない（自陣から本丸は撃てない）。
  function shoot(state, target) {
    if (state.over || !state.player.alive || state.player.cool > 0) return false;
    var tx, tz;
    var m = null;
    if (target.type === 'base') { tx = 0; tz = -38; }
    else {
      state.monsters.forEach(function (o) { if (o.id === target.id) m = o; });
      if (!m || m.side !== 'enemy') return false;
      tx = m.x; tz = m.z;
    }
    var dx = tx - state.player.x, dz = tz - state.player.z;
    if (Math.sqrt(dx * dx + dz * dz) > CONFIG.gunRange) return false;
    state.player.cool = CONFIG.gunCooldown;
    if (target.type === 'base') {
      // 本丸は硬い：銃のダメージは1/4。モンスターが本丸壊しの主役。
      state.base.enemy -= CONFIG.gunDamage * 0.25 * buff(state);
    } else {
      m.hp -= CONFIG.gunDamage * buff(state);
      if (m.hp <= 0) killMonster(state, m, 'own');
    }
    if (state.base.enemy <= 0 && !state.over) { state.over = true; state.result = 'win'; }
    return true;
  }

  // 敵AIの銃撃（敵AIもプレイヤーと同じように撃ってくる）。一定間隔で呼ぶ想定。
  function enemyShoot(state) {
    if (state.over) return 0;
    var dmg = 8;
    if (state.player.alive) {
      state.player.hp -= dmg;
      if (state.player.hp <= 0) {
        state.player.alive = false;
        state.player.respawnIn = CONFIG.respawnDelay;
        state.log.push('やられた！ 5秒後にリスポーン');
      }
    } else {
      state.base.own -= dmg;
    }
    if (state.base.own <= 0 && !state.over) { state.over = true; state.result = 'lose'; }
    return dmg;
  }

  function hurtPlayer(state, dmg) {
    if (!state.player.alive || state.over) return;
    state.player.hp -= dmg;
    if (state.player.hp <= 0) {
      state.player.alive = false;
      state.player.respawnIn = CONFIG.respawnDelay;
      state.log.push('やられた！ 5秒後にリスポーン');
    }
  }

  function timeLeft(state) { return Math.max(0, CONFIG.duration - state.time); }

  return {
    CONFIG: CONFIG, MONSTER_STATS: MONSTER_STATS,
    createGame: createGame, tick: tick, summon: summon, canSummon: canSummon,
    costOf: costOf, damageOf: damageOf, unlockedAt: unlockedAt,
    shoot: shoot, setPlayerPos: setPlayerPos, enemyShoot: enemyShoot, hurtPlayer: hurtPlayer,
    gainXp: gainXp, timeLeft: timeLeft, buff: buff
  };
});
