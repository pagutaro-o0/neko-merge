const { Engine, Render, Runner, Bodies, Body, Composite, Events, Vector } = Matter;

const worldCanvas = document.getElementById("world");
const overlayCanvas = document.getElementById("overlay");

const scoreEl = document.getElementById("score");
const bestEl  = document.getElementById("best");
const retryBtn = document.getElementById("retry");

let score = 0;
let best = 0;

async function loadBest(){
  try{
    const r = await fetch("/api/best");
    const j = await r.json();
    best = j.score || 0;
    bestEl.textContent = best;
  }catch(e){}
}
loadBest();

function saveBestIfNeeded(){
  if (score <= best) return;
  best = score;
  bestEl.textContent = best;
  fetch("/api/best", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ score })
  }).catch(()=>{});
}

const engine = Engine.create();
engine.gravity.y = 1.05;

let render, runner;

let W = 0, H = 0;
let dangerY = 0;
let walls = [];

const LEVELS = 8;
const RATIO = [0.055,0.07,0.09,0.115,0.145,0.18,0.22,0.27]; // 箱幅基準

let gameOver = false;
let holding = false;
let canDrop = true;
let previewX = 0;
let currentLv = 0;

// ===== 画像を“丸く抜いたテクスチャ”にして四角感を消す =====
let CAT_TEXTURE = window.CAT_IMG_URL;
const catImg = new Image();
catImg.src = window.CAT_IMG_URL;

function makeCircleTexture(img){
  const s = 1024;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");

  ctx.clearRect(0,0,s,s);
  ctx.beginPath();
  ctx.arc(s/2, s/2, s/2, 0, Math.PI*2);
  ctx.clip();

  const sw = img.naturalWidth, sh = img.naturalHeight;
  const m = Math.min(sw, sh);
  const sx = (sw - m) / 2;
  const sy = (sh - m) / 2;
  ctx.drawImage(img, sx, sy, m, m, 0, 0, s, s);

  return c.toDataURL("image/png");
}

catImg.onload = () => {
  CAT_TEXTURE = makeCircleTexture(catImg);
};

// ===== renderer =====
function setupRenderer(){
  if (render) Render.stop(render);
  if (runner) Runner.stop(runner);

  render = Render.create({
    canvas: worldCanvas,
    engine,
    options: {
      wireframes:false,
      background:"transparent",
      pixelRatio: window.devicePixelRatio || 1
    }
  });

  runner = Runner.create();
  Render.run(render);
  Runner.run(runner, engine);
}

// ===== layout =====
function resize(){
  const vw = window.innerWidth;
  const vh = window.innerHeight - 56;

  // 箱の縦横比（縦長）
  const targetRatio = 16/9; // height/width
  const boxH = Math.min(vh * 0.9, vw * targetRatio * 0.95);
  const boxW = boxH / targetRatio;

  W = Math.floor(boxW);
  H = Math.floor(boxH);

  worldCanvas.width = W;
  worldCanvas.height = H;
  overlayCanvas.width = W;
  overlayCanvas.height = H;

  // 見た目上のサイズも一致させる
  worldCanvas.style.width = `${W}px`;
  worldCanvas.style.height = `${H}px`;
  overlayCanvas.style.width = `${W}px`;
  overlayCanvas.style.height = `${H}px`;

  render.options.width = W;
  render.options.height = H;

  // 危険ライン
  dangerY = H * 0.18;

  rebuildWalls();

  // 初期プレビュー位置
  previewX = W/2;
}
window.addEventListener("resize", resize);

function rebuildWalls(){
  // remove old walls
  for (const w of walls) Composite.remove(engine.world, w);
  walls = [];

  const t = 80;
  const left  = Bodies.rectangle(-t/2, H/2, t, H*2, { isStatic:true, render:{ visible:false } });
  const right = Bodies.rectangle(W+t/2, H/2, t, H*2, { isStatic:true, render:{ visible:false } });
  const floor = Bodies.rectangle(W/2, H+t/2, W*2, t, { isStatic:true, render:{ visible:false } });

  walls.push(left,right,floor);
  Composite.add(engine.world, walls);
}

// ===== balls =====
function levelRadius(lv){
  return RATIO[lv] * W;
}

function makeCatBall(x, y, lv){
  const r = levelRadius(lv);
  const body = Bodies.circle(x, y, r, {
    restitution: 0.05,
    friction: 0.45,
    frictionAir: 0.02,
    density: 0.0012,
    render: {
      sprite: {
        texture: CAT_TEXTURE,
        xScale: (r*2) / 1024,
        yScale: (r*2) / 1024
      }
    }
  });
  body.plugin = { lv, merged:false, spawnedAt: performance.now() };
  return body;
}

function updateScore(add){
  score += add;
  scoreEl.textContent = score;
  saveBestIfNeeded();
}

function resetGame(){
  score = 0;
  scoreEl.textContent = score;
  gameOver = false;
  holding = false;
  canDrop = true;
  currentLv = 0;

  Composite.clear(engine.world, false);
  rebuildWalls();
}
retryBtn.addEventListener("click", resetGame);

// ===== merge =====
Events.on(engine, "collisionStart", (evt) => {
  for (const pair of evt.pairs){
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (!a.plugin || !b.plugin) continue;
    if (a.plugin.merged || b.plugin.merged) continue;
    if (a.plugin.lv !== b.plugin.lv) continue;
    if (a.plugin.lv >= LEVELS-1) continue;

    a.plugin.merged = true;
    b.plugin.merged = true;

    const lv = a.plugin.lv;
    const mid = Vector.mult(Vector.add(a.position, b.position), 0.5);

    setTimeout(() => {
      Composite.remove(engine.world, a);
      Composite.remove(engine.world, b);
      const next = makeCatBall(mid.x, mid.y, lv+1);
      Composite.add(engine.world, next);
      updateScore(10 * (lv+1) * (lv+1));
    }, 0);
  }
});

// ===== input =====
function clampX(x){
  const r = levelRadius(currentLv);
  return Math.max(r, Math.min(W - r, x));
}

function pointerX(e){
  const rect = worldCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return (clientX - rect.left) * (W / rect.width);
}

function onDown(e){
  if (gameOver) return;
  holding = true;
  previewX = clampX(pointerX(e));
  e.preventDefault();
}
function onMove(e){
  if (!holding) return;
  previewX = clampX(pointerX(e));
  e.preventDefault();
}
function onUp(e){
  if (!holding) return;
  holding = false;
  if (gameOver) return;
  if (!canDrop) return;

  canDrop = false;

  // 重要：危険ラインより下にスポーン（即ゲームオーバーを防ぐ）
  const spawnY = dangerY + levelRadius(currentLv) + 10;
  const ball = makeCatBall(previewX, spawnY, currentLv);
  Composite.add(engine.world, ball);

  // 次はLv0〜2だけ
  const rnd = Math.random();
  currentLv = (rnd < 0.5) ? 0 : (rnd < 0.8 ? 1 : 2);

  setTimeout(()=>{ canDrop = true; }, 180);
  e.preventDefault();
}

worldCanvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);

worldCanvas.addEventListener("touchstart", onDown, { passive:false });
window.addEventListener("touchmove", onMove, { passive:false });
window.addEventListener("touchend", onUp, { passive:false });

// ===== overlay draw =====
(function drawOverlay(){
  const ctx = overlayCanvas.getContext("2d");

  function loop(){
    ctx.clearRect(0,0,W,H);

    // 枠
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W-2, H-2);

    // 危険ライン
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(0, dangerY);
    ctx.lineTo(W, dangerY);
    ctx.stroke();

    // ゴースト
    if (holding && !gameOver){
      const r = levelRadius(currentLv);
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(previewX, dangerY + r + 10, r, 0, Math.PI*2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }

    // GAME OVER判定：危険ラインより上に「止まってる玉」が一定時間いたら
    if (!gameOver){
      const bodies = Composite.allBodies(engine.world);
      const now = performance.now();
      for (const b of bodies){
        if (!b.plugin) continue;

        const r = b.circleRadius || 0;
        const speed = Math.hypot(b.velocity.x, b.velocity.y);

        const top = b.position.y - r;
        const aliveMs = now - (b.plugin.spawnedAt || now);

        // スポーン直後は無視（誤判定防止）
        if (aliveMs < 600) continue;

        if (top < dangerY && speed < 0.15){
          gameOver = true;
          break;
        }
      }
    }

    // GAME OVER表示
    if (gameOver){
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = "#fff";
      ctx.font = "700 28px system-ui";
      ctx.fillText("GAME OVER", 18, 44);
      ctx.globalAlpha = 1;
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }

  loop();
})();

// ===== boot =====
setupRenderer();
resize();
resetGame();