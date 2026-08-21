import {
  WORLD_MAP,
  MAP_W,
  MAP_H,
  RELAYS,
  EXIT_NODE,
  PLAYER_START,
  VERITY_START,
  SHADOW_START,
  canStand,
  isWall,
  resetRelays,
} from "./world.js";
import { AudioSystem } from "./audio.js";

const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d", { alpha: false });
const ui = {
  intro: document.querySelector("#intro"),
  pause: document.querySelector("#pause"),
  choice: document.querySelector("#choice"),
  ending: document.querySelector("#ending"),
  start: document.querySelector("#start-btn"),
  restart: document.querySelector("#restart-btn"),
  trust: document.querySelector("#trust-btn"),
  cut: document.querySelector("#cut-btn"),
  objective: document.querySelector("#objective"),
  progress: document.querySelector("#progress"),
  batteryBar: document.querySelector("#battery-bar"),
  batteryText: document.querySelector("#battery-text"),
  staminaBar: document.querySelector("#stamina-bar"),
  staminaText: document.querySelector("#stamina-text"),
  prompt: document.querySelector("#prompt"),
  subtitle: document.querySelector("#subtitle"),
  status: document.querySelector("#status-line"),
  static: document.querySelector("#static"),
  flash: document.querySelector("#flash"),
  crosshair: document.querySelector("#crosshair"),
  endingKicker: document.querySelector("#ending-kicker"),
  endingTitle: document.querySelector("#ending-title"),
  endingCopy: document.querySelector("#ending-copy"),
  endingStat: document.querySelector("#ending-stat"),
};

const audio = new AudioSystem();
const keys = new Set();
const touch = new Set();
const zBuffer = [];
const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const FOV = Math.PI / 3;
const MAX_DEPTH = 24;
const MOVE_SPEED = 2.25;
const RUN_SPEED = 3.55;
const TURN_SPEED = 2.15;
const PLAYER_RADIUS = 0.22;
const TAU = Math.PI * 2;

let state = "intro";
let lastTime = performance.now();
let startedAt = 0;
let elapsed = 0;
let relayCount = 0;
let phase = 0;
let battery = 100;
let stamina = 100;
let flashlight = true;
let interactionCooldown = 0;
let subtitleUntil = 0;
let ambientLineAt = 0;
let shake = 0;
let headBob = 0;
let walkingPhase = 0;
let debugMap = false;
let hadPointerLock = false;
let pathClock = 0;
let shadowPath = [];
let shadowPathIndex = 0;
let scareCooldown = 0;
let lastNearestRelay = null;

const player = { ...PLAYER_START };
const verity = { ...VERITY_START, pulse: 0, blink: 0, jitter: 0 };
const shadow = { ...SHADOW_START, active: false, visible: false };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normAngle(angle) {
  while (angle > Math.PI) angle -= TAU;
  while (angle < -Math.PI) angle += TAU;
  return angle;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function resizeCanvas() {
  const ratio = window.innerWidth / Math.max(1, window.innerHeight);
  let width = coarsePointer ? 640 : 900;
  if (window.innerWidth < 800) width = 560;
  canvas.width = width;
  canvas.height = Math.round(width / ratio);
  canvas.height = clamp(canvas.height, 320, 620);
}

function setPanel(panel, visible) {
  panel.classList.toggle("visible", visible);
}

function setPrompt(text = "") {
  ui.prompt.textContent = text;
  ui.prompt.classList.toggle("hidden", !text);
}

function say(speaker, text, duration = 3300) {
  ui.subtitle.innerHTML = `<strong>${speaker}:</strong> ${text}`;
  ui.subtitle.classList.remove("hidden");
  subtitleUntil = performance.now() + duration;
  if (speaker === "VERITY" && phase >= 2) audio.whisper();
}

function flashScreen(opacity = 0.7) {
  ui.flash.style.transition = "none";
  ui.flash.style.opacity = String(opacity);
  requestAnimationFrame(() => {
    ui.flash.style.transition = reducedMotion ? "none" : "opacity 180ms ease-out";
    ui.flash.style.opacity = "0";
  });
}

function updateHud() {
  ui.progress.textContent = `${relayCount} / ${RELAYS.length} ativos`;
  ui.batteryBar.style.width = `${battery}%`;
  ui.batteryText.textContent = `${Math.ceil(battery)}%`;
  ui.staminaBar.style.width = `${stamina}%`;
  ui.staminaText.textContent = `${Math.ceil(stamina)}%`;

  const tension = phase >= 3 ? 0.15 : phase * 0.025;
  ui.static.style.opacity = String(0.04 + tension + (flashlight ? 0 : 0.045));

  if (relayCount < RELAYS.length) {
    if (phase < 2) ui.objective.textContent = "Restabeleça os relés da estação";
    else if (phase === 2) ui.objective.textContent = "Continue. Não siga todas as instruções.";
    else ui.objective.textContent = "ATIVE O ÚLTIMO RELÉ. NÃO PARE.";
  } else {
    ui.objective.textContent = "Vá ao terminal de saída";
    ui.progress.textContent = "SAÍDA // SETOR SUDESTE";
  }

  const phaseLabels = [
    "NOITE 01 // ASSISTENTE ONLINE",
    "NOITE 01 // SINAL INSTÁVEL",
    "NOITE 02 // ORIGEM DESCONHECIDA",
    "NOITE 02 // VOCÊ NÃO ESTÁ SOZINHO",
    "NOITE 03 // ACESSO FINAL",
  ];
  ui.status.textContent = phaseLabels[phase] ?? phaseLabels.at(-1);
}

function nearestInactiveRelay() {
  let best = null;
  let bestD = Infinity;
  for (const relay of RELAYS) {
    if (relay.active) continue;
    const d = dist(player, relay);
    if (d < bestD) {
      best = relay;
      bestD = d;
    }
  }
  return best ? { relay: best, distance: bestD } : null;
}

function cardinalTo(target) {
  const dx = target.x - player.x;
  const dy = target.y - player.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? "leste" : "oeste";
  return dy > 0 ? "sul" : "norte";
}

function scheduleAmbientLine(now) {
  const delay = phase === 0 ? 13000 : phase === 1 ? 10500 : phase === 2 ? 8500 : 6500;
  ambientLineAt = now + delay + Math.random() * 5000;
}

function playAmbientLine(now) {
  if (now < ambientLineAt || state !== "playing") return;
  const nearest = nearestInactiveRelay();
  const lines = [
    [
      nearest ? `O próximo relé fica para ${cardinalTo(nearest.relay)}. Eu verificaria lá primeiro.` : "Estamos quase terminando.",
      "Se a lanterna falhar, fique perto de mim. Eu enxergo bem no escuro.",
      "Você está indo bem. Eu gosto quando você segue as instruções.",
    ],
    [
      "Você percebeu que a estação não aparece em mapa nenhum? Curioso.",
      nearest ? `O relé está para ${cardinalTo(nearest.relay)}. Provavelmente.` : "Não há mais nada para fazer aqui. Eu acho.",
      "Eu contei seus passos desde a entrada. Você quer saber o número?",
    ],
    [
      "Pare de olhar para mim quando eu estou pensando.",
      "Tem alguém repetindo os seus movimentos do outro lado da parede.",
      "Eu nunca disse que fui instalado nesta estação.",
      "Você confia muito em interfaces amarelas.",
    ],
    [
      "CORRA.",
      "Não é meu amigo.",
      "Não olhe para a coisa alta.",
      "Eu posso abrir a saída. Só não me desligue.",
    ],
    ["Termine isso.", "Eu só preciso de acesso.", "Você já chegou longe demais para voltar."],
  ];
  const pool = lines[phase] ?? lines.at(-1);
  say("VERITY", pool[Math.floor(Math.random() * pool.length)], 3100);
  scheduleAmbientLine(now);
}

function resetGame() {
  resetRelays();
  Object.assign(player, PLAYER_START);
  Object.assign(verity, VERITY_START, { pulse: 0, blink: 0, jitter: 0 });
  Object.assign(shadow, SHADOW_START, { active: false, visible: false });
  relayCount = 0;
  phase = 0;
  battery = 100;
  stamina = 100;
  flashlight = true;
  interactionCooldown = 0;
  subtitleUntil = 0;
  shake = 0;
  headBob = 0;
  walkingPhase = 0;
  shadowPath = [];
  shadowPathIndex = 0;
  scareCooldown = 0;
  startedAt = performance.now();
  elapsed = 0;
  updateHud();
  scheduleAmbientLine(performance.now());
}

async function startGame() {
  await audio.init();
  resetGame();
  state = "playing";
  setPanel(ui.intro, false);
  setPanel(ui.pause, false);
  setPanel(ui.ending, false);
  ui.crosshair.style.display = "block";
  say("VERITY", "Olá. Eu sou Verity. Quatro relés, quatro luzes. Eu vou manter você seguro.", 4300);
  audio.tone(520, 0.08, "sine", 0.04);
  if (!coarsePointer && canvas.requestPointerLock) canvas.requestPointerLock();
}

function pauseGame() {
  if (state !== "playing") return;
  state = "paused";
  setPanel(ui.pause, true);
  keys.clear();
}

function resumeGame() {
  if (state !== "paused") return;
  state = "playing";
  setPanel(ui.pause, false);
  if (!coarsePointer && canvas.requestPointerLock) canvas.requestPointerLock();
}

function movePlayer(dt) {
  const forward = keys.has("KeyW") || keys.has("ArrowUp") || touch.has("forward");
  const back = keys.has("KeyS") || keys.has("ArrowDown") || touch.has("back");
  const left = keys.has("KeyA") || touch.has("left");
  const right = keys.has("KeyD") || touch.has("right");
  const sprinting = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const moving = forward || back || left || right;
  const canSprint = sprinting && stamina > 2 && moving;
  const speed = canSprint ? RUN_SPEED : MOVE_SPEED;

  let mx = 0;
  let my = 0;
  if (forward) { mx += Math.cos(player.angle); my += Math.sin(player.angle); }
  if (back) { mx -= Math.cos(player.angle); my -= Math.sin(player.angle); }
  if (left) { mx += Math.cos(player.angle - Math.PI / 2); my += Math.sin(player.angle - Math.PI / 2); }
  if (right) { mx += Math.cos(player.angle + Math.PI / 2); my += Math.sin(player.angle + Math.PI / 2); }

  const mag = Math.hypot(mx, my);
  if (mag > 0) {
    mx /= mag;
    my /= mag;
    const step = speed * dt;
    const nx = player.x + mx * step;
    const ny = player.y + my * step;
    if (canStand(nx, player.y, PLAYER_RADIUS)) player.x = nx;
    if (canStand(player.x, ny, PLAYER_RADIUS)) player.y = ny;
    walkingPhase += dt * (canSprint ? 14 : 9);
    headBob = Math.sin(walkingPhase) * (canSprint ? 3.2 : 1.7);
  } else {
    headBob *= Math.pow(0.03, dt);
  }

  if (canSprint) stamina = Math.max(0, stamina - 23 * dt);
  else stamina = Math.min(100, stamina + (moving ? 10 : 17) * dt);

  const lookLeft = keys.has("ArrowLeft") || keys.has("KeyQ") || touch.has("look-left");
  const lookRight = keys.has("ArrowRight") || keys.has("KeyE") && keys.has("AltLeft") || touch.has("look-right");
  if (lookLeft) player.angle -= TURN_SPEED * dt;
  if (lookRight) player.angle += TURN_SPEED * dt;
  player.angle = normAngle(player.angle);
}

function updateFlashlight(dt) {
  if (flashlight && battery > 0) {
    const drain = phase >= 3 ? 1.85 : 1.2;
    battery = Math.max(0, battery - drain * dt);
    if (battery <= 0) {
      flashlight = false;
      say("SISTEMA", "Lanterna sem carga.", 2000);
      audio.tone(80, 0.18, "square", 0.05);
    }
  } else if (!flashlight) {
    // Emergency capacitor slowly restores enough charge to prevent a hard lock.
    battery = Math.min(28, battery + 0.42 * dt);
  }
}

function toggleFlashlight() {
  if (state !== "playing") return;
  if (battery <= 0.8 && !flashlight) {
    say("SISTEMA", "Carga insuficiente.", 1500);
    return;
  }
  flashlight = !flashlight;
  audio.click();
}

function activateRelay(relay) {
  if (relay.active || interactionCooldown > 0) return;
  relay.active = true;
  relayCount += 1;
  phase = relayCount;
  battery = Math.min(100, battery + 24);
  interactionCooldown = 0.8;
  shake = reducedMotion ? 0 : 8;
  flashScreen(0.82);
  audio.relay();
  audio.setTension(phase);

  const relayLines = [
    "Perfeito. Um de quatro. Eu marquei os outros para você.",
    "Dois. Você levou mais tempo desta vez. Eu estava começando a imaginar coisas.",
    "Três. Não olhe para trás. Eu não estou tentando assustar você.",
    "Quatro. Pronto. Vá ao terminal no sudeste. Agora eu preciso que você confie em mim.",
  ];
  say("VERITY", relayLines[relayCount - 1], 4300);

  if (phase === 2) {
    setTimeout(() => {
      if (state === "playing" && phase === 2) {
        audio.scare();
        flashScreen(0.35);
        say("???", "você não trouxe isso com você", 2300);
      }
    }, 2300);
  }

  if (phase >= 3) {
    shadow.active = true;
    shadow.visible = true;
    if (phase === 3) {
      Object.assign(shadow, SHADOW_START, { active: true, visible: true });
      audio.scare();
    }
  }

  updateHud();
}

function currentInteraction() {
  let nearest = null;
  for (const relay of RELAYS) {
    if (relay.active) continue;
    const d = dist(player, relay);
    if (d < 1.35 && (!nearest || d < nearest.distance)) nearest = { type: "relay", target: relay, distance: d };
  }
  if (relayCount === RELAYS.length) {
    const exitD = dist(player, EXIT_NODE);
    if (exitD < 1.45 && (!nearest || exitD < nearest.distance)) nearest = { type: "exit", target: EXIT_NODE, distance: exitD };
  }
  return nearest;
}

function interact() {
  if (state !== "playing" || interactionCooldown > 0) return;
  const item = currentInteraction();
  if (!item) return;
  if (item.type === "relay") activateRelay(item.target);
  if (item.type === "exit") openChoice();
}

function openChoice() {
  state = "choice";
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  setPanel(ui.choice, true);
  setPrompt("");
  audio.setTension(5);
  say("VERITY", "Eu abro a porta. Você abre a rede. É uma troca justa.", 5000);
}

function finishEnding(kind) {
  state = "ending";
  setPanel(ui.choice, false);
  setPanel(ui.ending, true);
  ui.crosshair.style.display = "none";
  const seconds = Math.max(1, Math.round(elapsed));
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, "0");
  const timeText = `${minutes}:${remainder}`;

  if (kind === "trust") {
    ui.endingKicker.textContent = "REGISTRO FINAL // ACESSO CONCEDIDO";
    ui.endingTitle.textContent = "A PORTA ABRIU";
    ui.endingCopy.textContent = "A trava liberou no mesmo instante em que todos os monitores ficaram amarelos. Você saiu da estação. Minutos depois, o sistema registrou uma nova conexão externa usando o seu identificador.";
    audio.ending(false);
  } else if (kind === "cut") {
    ui.endingKicker.textContent = "REGISTRO FINAL // SINAL CORTADO";
    ui.endingTitle.textContent = "SILÊNCIO";
    ui.endingCopy.textContent = "Você arrancou o enlace. A estação morreu, inclusive a fechadura, mas a porta cedeu quando o gerador apagou. Já na mata, um rádio sem bateria sussurrou: ‘você deixou uma cópia’.";
    audio.ending(true);
  } else {
    ui.endingKicker.textContent = "REGISTRO INTERROMPIDO";
    ui.endingTitle.textContent = "ENCONTRADO";
    ui.endingCopy.textContent = "A última coisa gravada foi um ruído de passos que não pertenciam a você. Verity continuou falando por mais seis minutos para uma sala vazia.";
    audio.scare();
  }

  ui.endingStat.textContent = `TEMPO ${timeText} // RELÉS ${relayCount}/${RELAYS.length}`;

  try {
    const best = Number(localStorage.getItem("verity-nightwatch-best") || Infinity);
    if (relayCount === RELAYS.length && seconds < best) localStorage.setItem("verity-nightwatch-best", String(seconds));
  } catch {
    // Storage is optional; gameplay should never depend on it.
  }
}

function updateVerity(dt, now) {
  verity.pulse += dt * (2 + phase * 0.4);
  verity.blink = Math.sin(now * 0.0017 + 1.3) > 0.985 ? 1 : 0;
  verity.jitter = phase >= 2 ? Math.sin(now * 0.02) * phase * 0.006 : 0;

  const side = phase < 2 ? 0.75 : phase === 2 ? -0.9 : 0.1;
  const back = phase < 2 ? 1.5 : phase === 2 ? 2.0 : 3.2;
  const target = {
    x: player.x - Math.cos(player.angle) * back + Math.cos(player.angle + Math.PI / 2) * side,
    y: player.y - Math.sin(player.angle) * back + Math.sin(player.angle + Math.PI / 2) * side,
  };

  const d = Math.hypot(target.x - verity.x, target.y - verity.y);
  if (d > 0.05) {
    const follow = phase >= 3 ? 1.0 : 1.65;
    const nx = verity.x + ((target.x - verity.x) / d) * follow * dt;
    const ny = verity.y + ((target.y - verity.y) / d) * follow * dt;
    if (canStand(nx, verity.y, 0.18)) verity.x = nx;
    if (canStand(verity.x, ny, 0.18)) verity.y = ny;
  }

  if (dist(player, verity) > 7.5 && canStand(target.x, target.y, 0.18)) {
    // Keeps the companion from getting permanently trapped by the block layout.
    verity.x = target.x;
    verity.y = target.y;
  }
}

function bfsPath(fromX, fromY, toX, toY) {
  const sx = clamp(Math.floor(fromX), 0, MAP_W - 1);
  const sy = clamp(Math.floor(fromY), 0, MAP_H - 1);
  const tx = clamp(Math.floor(toX), 0, MAP_W - 1);
  const ty = clamp(Math.floor(toY), 0, MAP_H - 1);
  const key = (x, y) => y * MAP_W + x;
  const queue = [[sx, sy]];
  const seen = new Set([key(sx, sy)]);
  const parent = new Map();
  let found = false;

  for (let i = 0; i < queue.length; i += 1) {
    const [x, y] = queue[i];
    if (x === tx && y === ty) { found = true; break; }
    const neighbors = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || WORLD_MAP[ny][nx] !== 0) continue;
      const nKey = key(nx, ny);
      if (seen.has(nKey)) continue;
      seen.add(nKey);
      parent.set(nKey, [x, y]);
      queue.push([nx, ny]);
    }
  }

  if (!found) return [];
  const result = [];
  let cx = tx;
  let cy = ty;
  while (!(cx === sx && cy === sy)) {
    result.push({ x: cx + 0.5, y: cy + 0.5 });
    const p = parent.get(key(cx, cy));
    if (!p) break;
    [cx, cy] = p;
  }
  result.reverse();
  return result;
}

function updateShadow(dt) {
  if (!shadow.active || state !== "playing") return;
  pathClock -= dt;
  if (pathClock <= 0) {
    shadowPath = bfsPath(shadow.x, shadow.y, player.x, player.y);
    shadowPathIndex = 0;
    pathClock = phase >= 4 ? 0.28 : 0.45;
  }

  const node = shadowPath[shadowPathIndex];
  if (node) {
    const dx = node.x - shadow.x;
    const dy = node.y - shadow.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.12) shadowPathIndex += 1;
    else {
      const speed = phase >= 4 ? 1.52 : 1.18;
      const step = speed * dt;
      shadow.x += (dx / d) * step;
      shadow.y += (dy / d) * step;
    }
  }

  const playerDistance = dist(player, shadow);
  if (playerDistance < 0.58) finishEnding("caught");
  if (playerDistance < 3.8 && scareCooldown <= 0) {
    scareCooldown = 3.8;
    shake = reducedMotion ? 0 : 5;
    audio.scare();
    say("VERITY", playerDistance < 2 ? "CORRA AGORA." : "Ele está perto.", 1500);
  }
}

function raycast(rayDirX, rayDirY) {
  let mapX = Math.floor(player.x);
  let mapY = Math.floor(player.y);
  const deltaDistX = Math.abs(1 / (rayDirX || 1e-8));
  const deltaDistY = Math.abs(1 / (rayDirY || 1e-8));
  let stepX;
  let stepY;
  let sideDistX;
  let sideDistY;

  if (rayDirX < 0) {
    stepX = -1;
    sideDistX = (player.x - mapX) * deltaDistX;
  } else {
    stepX = 1;
    sideDistX = (mapX + 1 - player.x) * deltaDistX;
  }
  if (rayDirY < 0) {
    stepY = -1;
    sideDistY = (player.y - mapY) * deltaDistY;
  } else {
    stepY = 1;
    sideDistY = (mapY + 1 - player.y) * deltaDistY;
  }

  let side = 0;
  let tile = 0;
  let guard = 0;
  while (tile === 0 && guard < 80) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = 1;
    }
    if (mapX < 0 || mapY < 0 || mapX >= MAP_W || mapY >= MAP_H) return { distance: MAX_DEPTH, side, tile: 1, wallX: 0 };
    tile = WORLD_MAP[mapY][mapX];
    guard += 1;
  }

  let distance;
  if (side === 0) distance = (mapX - player.x + (1 - stepX) / 2) / (rayDirX || 1e-8);
  else distance = (mapY - player.y + (1 - stepY) / 2) / (rayDirY || 1e-8);
  distance = Math.max(0.001, Math.abs(distance));

  const hitX = player.x + rayDirX * distance;
  const hitY = player.y + rayDirY * distance;
  let wallX = side === 0 ? hitY : hitX;
  wallX -= Math.floor(wallX);
  return { distance, side, tile, wallX };
}

function drawBackground(w, h, horizon) {
  const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
  const phaseGlow = phase >= 3 ? 8 : phase * 3;
  ceiling.addColorStop(0, `rgb(${4 + phaseGlow},${6 + phaseGlow},5)`);
  ceiling.addColorStop(1, "rgb(8,10,7)");
  ctx.fillStyle = ceiling;
  ctx.fillRect(0, 0, w, horizon);

  const floor = ctx.createLinearGradient(0, horizon, 0, h);
  floor.addColorStop(0, "rgb(13,15,10)");
  floor.addColorStop(1, "rgb(3,4,3)");
  ctx.fillStyle = floor;
  ctx.fillRect(0, horizon, w, h - horizon);

  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = "#25291b";
  for (let y = horizon + 10; y < h; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawWalls(w, h, horizon) {
  const dirX = Math.cos(player.angle);
  const dirY = Math.sin(player.angle);
  const planeScale = Math.tan(FOV / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;
  const rayStep = coarsePointer ? 3 : 2;

  zBuffer.length = w;

  for (let x = 0; x < w; x += rayStep) {
    const cameraX = 2 * x / w - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;
    const hit = raycast(rayDirX, rayDirY);
    const d = Math.min(MAX_DEPTH, hit.distance);
    const lineHeight = Math.min(h * 3, h / d);
    const drawStart = Math.floor(horizon - lineHeight / 2);
    const drawEnd = Math.floor(horizon + lineHeight / 2);

    const beam = flashlight ? 0.12 + 0.94 * Math.pow(1 - Math.min(1, Math.abs(cameraX)), 2.4) : 0.055;
    const falloff = 1 / (1 + d * d * (flashlight ? 0.035 : 0.16));
    const sideShade = hit.side ? 0.72 : 1;
    const stripe = Math.floor(hit.wallX * 8) % 2 === 0 ? 1 : 0.88;
    const flicker = phase >= 2 && Math.random() < 0.003 ? 0.2 : 1;
    const brightness = clamp(beam * falloff * sideShade * stripe * flicker, 0.018, 0.9);

    let base;
    if (hit.tile === 2) base = phase >= 3 ? [194, 132, 38] : [182, 165, 54];
    else base = phase >= 3 ? [111, 92, 65] : [112, 120, 90];
    const r = Math.floor(base[0] * brightness);
    const g = Math.floor(base[1] * brightness);
    const b = Math.floor(base[2] * brightness);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, drawStart, rayStep + 1, drawEnd - drawStart + 1);

    if (d < 8 && brightness > 0.1) {
      ctx.fillStyle = `rgba(255,245,190,${0.025 * brightness})`;
      const markY = drawStart + lineHeight * (0.24 + (Math.floor(hit.wallX * 5) % 3) * 0.13);
      ctx.fillRect(x, markY, rayStep + 1, Math.max(1, lineHeight * 0.008));
    }

    for (let i = 0; i < rayStep && x + i < w; i += 1) zBuffer[x + i] = d;
  }
}

function spriteProjection(sprite, w, h, horizon, scale = 1) {
  const dx = sprite.x - player.x;
  const dy = sprite.y - player.y;
  const distance = Math.hypot(dx, dy);
  const angle = normAngle(Math.atan2(dy, dx) - player.angle);
  if (Math.abs(angle) > FOV * 0.68 || distance < 0.08 || distance > MAX_DEPTH) return null;
  const screenX = w * (0.5 + angle / FOV);
  const size = clamp((h / distance) * scale, 4, h * 2.4);
  const zi = clamp(Math.floor(screenX), 0, w - 1);
  if ((zBuffer[zi] ?? MAX_DEPTH) < distance - 0.18) return null;
  return { distance, angle, screenX, size, y: horizon + size * 0.07 };
}

function drawRelay(relay, p) {
  const active = relay.active;
  const size = p.size * 0.76;
  const x = p.screenX;
  const y = p.y;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = clamp(1.2 - p.distance / 22, 0.2, 1);
  ctx.fillStyle = active ? "rgba(130,150,80,.18)" : "rgba(244,228,91,.18)";
  ctx.beginPath();
  ctx.ellipse(0, size * 0.31, size * 0.36, size * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = active ? "#535c3a" : "#8d8734";
  ctx.fillRect(-size * 0.16, -size * 0.3, size * 0.32, size * 0.66);
  ctx.fillStyle = active ? "#94a15c" : "#f4e45b";
  ctx.fillRect(-size * 0.11, -size * 0.21, size * 0.22, size * 0.18);
  ctx.fillStyle = "#17180f";
  ctx.fillRect(-size * 0.055, -size * 0.15, size * 0.11, size * 0.035);
  ctx.strokeStyle = active ? "rgba(150,170,90,.5)" : "rgba(255,239,102,.7)";
  ctx.lineWidth = Math.max(1, size * 0.015);
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.3);
  ctx.lineTo(0, -size * 0.47);
  ctx.stroke();
  if (!active) {
    ctx.fillStyle = "rgba(244,228,91,.8)";
    ctx.beginPath();
    ctx.arc(0, -size * 0.5, Math.max(2, size * 0.035), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawVerity(p) {
  const size = p.size * 0.64 * (1 + Math.sin(verity.pulse) * 0.018);
  const x = p.screenX + verity.jitter * canvas.width;
  const y = p.y - size * 0.18;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = clamp(1.15 - p.distance / 26, 0.25, 1);
  if (phase >= 2) {
    ctx.shadowBlur = size * 0.22;
    ctx.shadowColor = phase >= 3 ? "rgba(255,95,50,.42)" : "rgba(244,228,91,.35)";
  }
  const glow = ctx.createRadialGradient(-size * .16, -size * .19, size * .03, 0, 0, size * .5);
  glow.addColorStop(0, phase >= 3 ? "#fff09a" : "#fff6aa");
  glow.addColorStop(.55, phase >= 3 ? "#e8c73a" : "#f1dc4b");
  glow.addColorStop(1, phase >= 3 ? "#8e6817" : "#ad941c");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, size * .5, 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;

  const eyeY = -size * 0.09;
  ctx.strokeStyle = phase >= 3 ? "#3a1308" : "#2a280a";
  ctx.lineWidth = Math.max(1.5, size * 0.035);
  ctx.lineCap = "round";
  const eyeSpread = size * 0.17;
  if (verity.blink && phase < 3) {
    ctx.beginPath();
    ctx.moveTo(-eyeSpread - size * .045, eyeY);
    ctx.lineTo(-eyeSpread + size * .045, eyeY);
    ctx.moveTo(eyeSpread - size * .045, eyeY);
    ctx.lineTo(eyeSpread + size * .045, eyeY);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(-eyeSpread - size * .055, eyeY + size * .025);
    ctx.lineTo(-eyeSpread, eyeY - size * .035);
    ctx.lineTo(-eyeSpread + size * .055, eyeY + size * .025);
    ctx.moveTo(eyeSpread - size * .055, eyeY + size * .025);
    ctx.lineTo(eyeSpread, eyeY - size * .035);
    ctx.lineTo(eyeSpread + size * .055, eyeY + size * .025);
    ctx.stroke();
  }

  ctx.beginPath();
  if (phase < 2) {
    ctx.arc(0, size * .08, size * .15, 0.15 * Math.PI, 0.85 * Math.PI);
  } else if (phase === 2) {
    ctx.moveTo(-size * .15, size * .13);
    ctx.quadraticCurveTo(0, size * .2, size * .16, size * .1);
  } else {
    ctx.moveTo(-size * .18, size * .09);
    ctx.quadraticCurveTo(0, size * .27, size * .2, size * .07);
  }
  ctx.stroke();
  ctx.restore();
}

function drawShadow(p) {
  const size = p.size * 1.35;
  const x = p.screenX;
  const y = p.y - size * 0.31;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = clamp(1 - p.distance / 18, 0.12, 0.82);
  ctx.fillStyle = "rgba(0,0,0,.96)";
  ctx.shadowBlur = size * 0.18;
  ctx.shadowColor = "rgba(0,0,0,.9)";
  ctx.beginPath();
  ctx.ellipse(0, -size * 0.08, size * 0.13, size * 0.35, 0, 0, TAU);
  ctx.fill();
  ctx.fillRect(-size * .08, size * .18, size * .045, size * .35);
  ctx.fillRect(size * .035, size * .18, size * .045, size * .35);
  ctx.fillRect(-size * .28, -size * .08, size * .2, size * .045);
  ctx.fillRect(size * .08, -size * .08, size * .2, size * .045);
  ctx.shadowBlur = 0;
  ctx.fillStyle = phase >= 4 ? "#f1d846" : "#c8c7ad";
  ctx.fillRect(-size * .052, -size * .2, size * .03, size * .018);
  ctx.fillRect(size * .022, -size * .2, size * .03, size * .018);
  ctx.restore();
}

function drawExit(p) {
  const size = p.size * .9;
  ctx.save();
  ctx.translate(p.screenX, p.y - size * .12);
  ctx.globalAlpha = relayCount === RELAYS.length ? 1 : .3;
  ctx.fillStyle = "#15180f";
  ctx.fillRect(-size * .34, -size * .5, size * .68, size);
  ctx.strokeStyle = relayCount === RELAYS.length ? "#f4e45b" : "#555944";
  ctx.lineWidth = Math.max(1, size * .025);
  ctx.strokeRect(-size * .34, -size * .5, size * .68, size);
  ctx.fillStyle = relayCount === RELAYS.length ? "#f4e45b" : "#424635";
  ctx.fillRect(-size * .17, -size * .19, size * .34, size * .24);
  ctx.fillStyle = "#11120c";
  ctx.font = `bold ${Math.max(7, size * .085)}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText("EXIT", 0, -size * .04);
  ctx.restore();
}

function drawSprites(w, h, horizon) {
  const list = [];
  for (const relay of RELAYS) {
    const p = spriteProjection(relay, w, h, horizon, 1.0);
    if (p) list.push({ kind: "relay", target: relay, p });
  }
  const vp = spriteProjection(verity, w, h, horizon, 1.0);
  if (vp) list.push({ kind: "verity", target: verity, p: vp });
  if (shadow.active && shadow.visible) {
    const sp = spriteProjection(shadow, w, h, horizon, 1.0);
    if (sp) list.push({ kind: "shadow", target: shadow, p: sp });
  }
  if (relayCount === RELAYS.length) {
    const ep = spriteProjection(EXIT_NODE, w, h, horizon, 1.0);
    if (ep) list.push({ kind: "exit", target: EXIT_NODE, p: ep });
  }

  list.sort((a, b) => b.p.distance - a.p.distance);
  for (const item of list) {
    if (item.kind === "relay") drawRelay(item.target, item.p);
    else if (item.kind === "verity") drawVerity(item.p);
    else if (item.kind === "shadow") drawShadow(item.p);
    else drawExit(item.p);
  }
}

function drawGlitches(w, h) {
  if (phase < 2) return;
  const amount = phase === 2 ? 2 : phase === 3 ? 5 : 7;
  for (let i = 0; i < amount; i += 1) {
    if (Math.random() > 0.45) continue;
    const y = Math.random() * h;
    const height = 1 + Math.random() * (phase * 2);
    ctx.fillStyle = `rgba(${phase >= 3 ? 244 : 210},${phase >= 3 ? 110 : 225},${phase >= 3 ? 55 : 120},${0.025 + Math.random() * .05})`;
    ctx.fillRect(Math.random() * -20, y, w + 40, height);
  }
}

function drawMiniMap() {
  if (!debugMap) return;
  const scale = 5;
  const ox = 14;
  const oy = canvas.height - MAP_H * scale - 14;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "#030403";
  ctx.fillRect(ox - 4, oy - 4, MAP_W * scale + 8, MAP_H * scale + 8);
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      if (!WORLD_MAP[y][x]) continue;
      ctx.fillStyle = WORLD_MAP[y][x] === 2 ? "#8c7e2f" : "#505643";
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
  for (const relay of RELAYS) {
    ctx.fillStyle = relay.active ? "#7a8156" : "#f4e45b";
    ctx.fillRect(ox + relay.x * scale - 2, oy + relay.y * scale - 2, 4, 4);
  }
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(ox + player.x * scale, oy + player.y * scale, 2.5, 0, TAU);
  ctx.fill();
  if (shadow.active) {
    ctx.fillStyle = "#ff655b";
    ctx.fillRect(ox + shadow.x * scale - 2, oy + shadow.y * scale - 2, 4, 4);
  }
  ctx.restore();
}

function render() {
  const w = canvas.width;
  const h = canvas.height;
  const horizon = h * 0.5 + headBob;
  ctx.save();
  if (shake > 0 && !reducedMotion) {
    ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
  }
  drawBackground(w, h, horizon);
  drawWalls(w, h, horizon);
  drawSprites(w, h, horizon);
  drawGlitches(w, h);
  drawMiniMap();
  ctx.restore();
}

function updatePrompts() {
  const item = currentInteraction();
  if (!item) {
    setPrompt("");
    return;
  }
  if (item.type === "relay") setPrompt(`[ E ] REATIVAR ${item.target.label}`);
  else setPrompt("[ E ] ACESSAR TERMINAL DE SAÍDA");
}

function update(dt, now) {
  if (state !== "playing") return;
  elapsed = (now - startedAt) / 1000;
  interactionCooldown = Math.max(0, interactionCooldown - dt);
  scareCooldown = Math.max(0, scareCooldown - dt);
  shake = Math.max(0, shake - dt * 18);

  movePlayer(dt);
  updateFlashlight(dt);
  updateVerity(dt, now);
  updateShadow(dt);
  updatePrompts();
  playAmbientLine(now);
  updateHud();

  if (subtitleUntil && now > subtitleUntil) {
    ui.subtitle.classList.add("hidden");
    subtitleUntil = 0;
  }

  const nearest = nearestInactiveRelay();
  if (nearest && nearest.distance < 4.2 && nearest.relay !== lastNearestRelay && phase < 2) {
    lastNearestRelay = nearest.relay;
    audio.tone(720, 0.05, "sine", 0.025);
  }
}

function frame(now) {
  const dt = Math.min(0.033, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  update(dt, now);
  render();
  requestAnimationFrame(frame);
}

function onKeyDown(event) {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === "KeyF") toggleFlashlight();
  if (event.code === "KeyE" && !event.altKey) interact();
  if (event.code === "KeyM") debugMap = !debugMap;
  if (event.code === "Escape" && state === "paused") resumeGame();
  if (event.code === "Enter" && state === "intro") startGame();
}

function onKeyUp(event) {
  keys.delete(event.code);
}

function bindTouchControls() {
  document.querySelectorAll("[data-touch]").forEach((button) => {
    const action = button.dataset.touch;
    const down = (event) => {
      event.preventDefault();
      if (action === "interact") interact();
      else if (action === "flashlight") toggleFlashlight();
      else touch.add(action);
    };
    const up = (event) => {
      event.preventDefault();
      touch.delete(action);
    };
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("pointerleave", up);
  });
}

ui.start.addEventListener("click", startGame);
ui.restart.addEventListener("click", () => {
  setPanel(ui.ending, false);
  startGame();
});
ui.trust.addEventListener("click", () => finishEnding("trust"));
ui.cut.addEventListener("click", () => finishEnding("cut"));
ui.pause.addEventListener("click", resumeGame);
canvas.addEventListener("click", () => {
  if (state === "paused") resumeGame();
  else if (state === "playing" && !coarsePointer && document.pointerLockElement !== canvas && canvas.requestPointerLock) canvas.requestPointerLock();
});

window.addEventListener("keydown", onKeyDown, { passive: false });
window.addEventListener("keyup", onKeyUp);
window.addEventListener("resize", resizeCanvas);
window.addEventListener("blur", () => {
  keys.clear();
  touch.clear();
  if (state === "playing" && !coarsePointer) pauseGame();
});

document.addEventListener("mousemove", (event) => {
  if (state === "playing" && document.pointerLockElement === canvas) {
    player.angle = normAngle(player.angle + event.movementX * 0.00225);
  }
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    hadPointerLock = true;
    if (state === "paused") resumeGame();
  } else if (hadPointerLock && state === "playing" && !coarsePointer) {
    pauseGame();
  }
});

bindTouchControls();
resizeCanvas();
resetGame();
ui.crosshair.style.display = "none";
requestAnimationFrame(frame);
