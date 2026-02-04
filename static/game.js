const { Engine, Render, Runner, Bodies, Composite, Events, Vector } = Matter;

const worldCanvas = document.getElementById("world");
const overlayCanvas = document.getElementById("overlay");
const scoreEl = document.getElementById("score");
const bestEl = document.getElementById("best");
const retryBtn = document.getElementById("retry");

let score = 0;
let best = 0;

async function loadBest() {
  const r = await fetch("/api/best");
  const j = await r.json();
  best = j.score || 0;
  bestEl.textContent = best;
}
loadBest();

const engine = Engine.create();
engine.gravity.y = 1.1;

let render, runner;
let W=0, H=0, boxW=0, boxH=0;
let walls = [];
let dangerY = 0;

const LEVELS = 8;
// 半径（箱幅に対する比率で後でスケール）
const RATIO = [0.055,0.07,0.09,0.115,0.145,0.18,0.22,0.27];

const catImg = new Image();
catImg.src = window.CAT_IMG_URL;

function setupRenderer() {
  if (render) Render.stop(render);
  if (runner) Runner.stop(runner);

  render = Render.create({
  canvas: worldCanvas,
  engine,
  options: { wireframes:false, background:"transparent" }
});
  runner = Runner.create();
  Render.run(render);
  Runner.run(runner, engine);
}

function resize() {
  const vw = window.innerWidth;
  const vh = window.innerHeight - 56; // UI分
  // 箱比率 16:9（縦長）
  const targetRatio = 16/9;
  // 高さ優先で決める（PC横でも縦長箱を中央に大きく）
  boxH = Math.min(vh * 0.88, vw * targetRatio * 0.95);
  boxW = boxH / targetRatio;

  W = Math.floor(boxW);
  H = Math.floor(boxH);

 worldCanvas.width = W;
worldCanvas.height = H;
overlayCanvas.width = W;
overlayCanvas.height = H;

render.options.width = W;
render.options.height = H;
  // 危険ライン（上から15%）
  dangerY = H * 0.16;

  rebuildWalls();
}
window.addEventListener("resize", resize);

function rebuildWalls() {
  // 既存を消す
  for (const w of walls) Composite.remove(engine.world, w);
  walls = [];

  const t = 80; // 壁厚
  const left  = Bodies.rectangle(-t/2, H/2, t, H*2, { isStatic:true });
  const right = Bodies.rectangle(W+t/2, H/2, t, H*2, { isStatic:true });
  const floor = Bodies.rectangle(W/2, H+t/2, W*2, t, { isStatic:true });
  walls.push(left,right,floor);
  Composite.add(engine.world, walls);
}

function levelRadius(lv){
  return RATIO[lv] * W; // 箱幅基準
}

function makeCatBall(x, y, lv) {
  const r = levelRadius(lv);
  const body = Bodies.circle(x, y, r, {
    restitution: 0.05,
    friction: 0.4,
    frictionAir: 0.02,
    density: 0.0012,
    render: {
      sprite: {
        texture: window.CAT_IMG_URL,
        xScale: (r*2) / 1024,
        yScale: (r*2) / 1024
      }
    }
  });
  body.plugin = { lv, merged:false };
  return body;
}

let previewX = W/2;
let holding = false;
let canDrop = true;
let currentLv = 0;

function resetGame() {
  score = 0;
  scoreEl.textContent = score;

  // ワールド掃除（壁以外）
  Composite.clear(engine.world, false);
  rebuildWalls();

  holding = false;
  canDrop = true;
  currentLv = 0;
}
retryBtn.onclick = resetGame;

function updateScore(add){
  score += add;
  scoreEl.textContent = score;
  if (score > best) {
    best = score;
    bestEl.textContent = best;
    fetch("/api/best", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ score })
    });
  }
}

// 合体判定：衝突イベント
Events.on(engine, "collisionStart", (evt) => {
  for (const pair of evt.pairs) {
    const a = pair.bodyA;
    const b = pair.bodyB;
    if (!a.plugin?.lv && a.plugin?.lv !== 0) continue;
    if (!b.plugin?.lv && b.plugin?.lv !== 0) continue;

    if (a.plugin.merged || b.plugin.merged) continue;
    if (a.plugin.lv !== b.plugin.lv) continue;

    const lv = a.plugin.lv;
    if (lv >= LEVELS-1) continue;

    // マージ予約（多重マージ防止）
    a.plugin.merged = true;
    b.plugin.merged = true;

    const mid = Vector.mult(Vector.add(a.position, b.position), 0.5);

    // 少し遅延して安全に置換
    setTimeout(() => {
      Composite.remove(engine.world, a);
      Composite.remove(engine.world, b);

      const next = makeCatBall(mid.x, mid.y, lv+1);
      Composite.add(engine.world, next);

      // スコア（Lvが上がるほど強く）
      updateScore(10 * (lv+1) * (lv+1));
    }, 0);
  }
});

// 入力（PC/スマホ統一）
function clampX(x){
  const r = levelRadius(currentLv);
  return Math.max(r, Math.min(W - r, x));
}

function pointerX(e){
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  return (clientX - rect.left) * (W / rect.width);
}

function onDown(e){
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
  if (!canDrop) return;

  canDrop = false;
  const ball = makeCatBall(previewX, 40, currentLv);
  Composite.add(engine.world, ball);

  // 次LvはLv0〜2だけ出す（遊びやすい）
  const rnd = Math.random();
  currentLv = (rnd < 0.5) ? 0 : (rnd < 0.8 ? 1 : 2);

  setTimeout(()=>{ canDrop = true; }, 250);
  e.preventDefault();
}

worldCanvas.addEventListener("mousedown", onDown);
window.addEventListener("mousemove", onMove);
window.addEventListener("mouseup", onUp);
worldCanvas.addEventListener("touchstart", onDown, { passive:false });
window.addEventListener("touchmove", onMove, { passive:false });
window.addEventListener("touchend", onUp, { passive:false });

// 見た目（プレビュー＆危険ライン）を描く
(function drawOverlay(){
  const ctx = overlayCanvas.getContext("2d");
  function loop(){
    ctx.clearRect(0,0,W,H);

    // 危険ライン
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(0, dangerY);
    ctx.lineTo(W, dangerY);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();

    // プレビュー（ゴースト）
    if (holding) {
      const r = levelRadius(currentLv);
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(previewX, 40, r, 0, Math.PI*2);
      ctx.fillStyle = "#fff";
      ctx.fill();
    }

    ctx.globalAlpha = 1.0;

    // ゲームオーバー判定（危険ラインより上に玉が来たら）
    const bodies = Composite.allBodies(engine.world);
    for (const b of bodies) {
      if (!b.plugin) continue;
      if (b.position.y - b.circleRadius < dangerY) {
        // オーバー（簡易）：入力停止
        canDrop = false;
      }
    }

    requestAnimationFrame(loop);
  }
  loop();
})();

setupRenderer();
resize();
resetGame();