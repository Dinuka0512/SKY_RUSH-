import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import Plane from "../../public/assets/airplane.webp";
import Rocket from "../../public/assets/roket.webp";

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const MAX_LIVES = 3;
const MAX_ROCKETS = 8;
const HIGH_SCORE_KEY = "airplaneGameHighScore";
const SETTINGS_KEY = "airplaneGameSettings";

const PLANE_NOSE_OFFSET_DEG = 90;
const ROCKET_NOSE_OFFSET_DEG = 90;

const PLANE_SPEED = 4;
const MAX_TURN = 0.065;
const IDLE_TURN = 0.02;
const MAX_BANK = 40;

const TRAIL_BASE_SIZE = 32;
const TAIL_OFFSET = 12;
const TRAIL_SPACING = 3;
const MAX_TRAIL_POINTS = 150;

const TRAIL_LINES = [
    { offset: -6, width: 1.4, alpha: 0.65, color: "34, 211, 238" },
    { offset: 0, width: 2.6, alpha: 1, color: "59, 130, 246" },
    { offset: 6, width: 1.4, alpha: 0.65, color: "96, 165, 250" }
];

const ROCKET_LIFETIME_MS = 9000;
const SAFE_SPAWN_DISTANCE = 280;

const POINTS_PER_SECOND = 10;
const SECONDS_PER_LEVEL = 15;
const HIT_COOLDOWN_MS = 1500;

const JOYSTICK_RADIUS = 48;

type Status = "playing" | "over";

type Stats = {
    score: number;
    time: number;
    level: number;
    lives: number;
};

type Point = {
    x: number;
    y: number;
};

type Mode = "idle" | "pointer" | "keys";

type RocketObj = {
    el: HTMLDivElement;
    x: number;
    y: number;
    heading: number;
    speed: number;
    turn: number;
    age: number;
    puff: number;
};

type Particle = {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    max: number;
    size: number;
    grow: number;
    alpha: number;
    color: string;
};

type GameSettings = {
    musicVolume: number;
    sfxVolume: number;
    musicMuted: boolean;
    sfxMuted: boolean;
};

const INITIAL_STATS: Stats = {
    score: 0,
    time: 0,
    level: 1,
    lives: MAX_LIVES
};

const DEFAULT_SETTINGS: GameSettings = {
    musicVolume: 10,
    sfxVolume: 55,
    musicMuted: false,
    sfxMuted: false
};

const formatTime = (seconds: number) =>
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
        seconds % 60
    ).padStart(2, "0")}`;

const getSavedHighScore = () => {
    if (typeof window === "undefined") return 0;

    try {
        const saved = Number(localStorage.getItem(HIGH_SCORE_KEY));
        return Number.isFinite(saved) && saved > 0 ? saved : 0;
    } catch {
        return 0;
    }
};

const getSavedSettings = (): GameSettings => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;

    try {
        const saved = localStorage.getItem(SETTINGS_KEY);

        if (!saved) return DEFAULT_SETTINGS;

        const parsed = JSON.parse(saved);

        return {
            musicVolume: Math.max(
                0,
                Math.min(100, Number(parsed.musicVolume ?? 10))
            ),
            sfxVolume: Math.max(
                0,
                Math.min(100, Number(parsed.sfxVolume ?? 55))
            ),
            musicMuted: Boolean(parsed.musicMuted),
            sfxMuted: Boolean(parsed.sfxMuted)
        };
    } catch {
        return DEFAULT_SETTINGS;
    }
};

/* ------------------------------------------------------------------ */
/* Settings row (UI helper)                                            */
/* ------------------------------------------------------------------ */

type SettingRowProps = {
    label: string;
    icon: ReactNode;
    value: number;
    muted: boolean;
    onVolume: (v: number) => void;
    onMute: (m: boolean) => void;
};

function SettingRow({
    label,
    icon,
    value,
    muted,
    onVolume,
    onMute
}: SettingRowProps) {
    return (
        <div>
            <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-slate-700">
                    {label}
                </span>
                <span className="text-xs font-semibold tabular-nums text-blue-500">
                    {muted ? "Muted" : `${value}%`}
                </span>
            </div>

            <div className="mt-3 flex items-center gap-3">
                <span className="text-blue-400 shrink-0">{icon}</span>
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={value}
                    onChange={(e) => onVolume(Number(e.target.value))}
                    aria-label={`${label} volume`}
                    className="game-slider w-full"
                />
            </div>

            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-500">
                <input
                    type="checkbox"
                    checked={muted}
                    onChange={(e) => onMute(e.target.checked)}
                    className="h-4 w-4 accent-blue-500"
                />
                Mute {label.toLowerCase()}
            </label>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Dotted-outline clouds (background decoration)                       */
/* ------------------------------------------------------------------ */

const CLOUD_PATH =
    "M45 80 H150 A22 22 0 0 0 150 36 A34 34 0 0 0 85 36 A32 32 0 0 0 45 80 Z";

const CLOUDS = [
    { top: "14%", width: 220, duration: 95, delay: -20, opacity: 0.75 },
    { top: "34%", width: 150, duration: 70, delay: -55, opacity: 0.55 },
    { top: "58%", width: 260, duration: 120, delay: -80, opacity: 0.65 },
    { top: "76%", width: 130, duration: 80, delay: -35, opacity: 0.5 }
];

function Clouds() {
    return (
        <div
            className="absolute inset-0 overflow-hidden pointer-events-none z-0"
            aria-hidden="true"
        >
            {CLOUDS.map((cloud, index) => (
                <svg
                    key={index}
                    viewBox="0 0 200 100"
                    className="cloud-drift absolute left-0"
                    style={{
                        top: cloud.top,
                        width: cloud.width,
                        opacity: cloud.opacity,
                        animationDuration: `${cloud.duration}s`,
                        animationDelay: `${cloud.delay}s`
                    }}
                >
                    <path
                        d={CLOUD_PATH}
                        fill="rgba(255,255,255,0.55)"
                        stroke="#93c5fd"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeDasharray="1 7"
                    />
                </svg>
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Game Component                                                      */
/* ------------------------------------------------------------------ */

export default function Play() {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blastAudioRef = useRef<HTMLAudioElement | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rocketLayerRef = useRef<HTMLDivElement>(null);
    const planeRef = useRef<HTMLDivElement>(null);
    const flashRef = useRef<HTMLDivElement>(null);

    const joystickRef = useRef<HTMLDivElement>(null);
    const joystickKnobRef = useRef<HTMLDivElement>(null);

    const joystickActiveRef = useRef(false);
    const joystickPointerIdRef = useRef<number | null>(null);

    const joystickVectorRef = useRef({
        x: 0,
        y: 0
    });

    const [stats, setStats] = useState<Stats>(INITIAL_STATS);
    const [status, setStatus] = useState<Status>("playing");
    const [runId, setRunId] = useState(0);

    const [paused, setPaused] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    const [highScore, setHighScore] = useState(getSavedHighScore);
    const highScoreRef = useRef(highScore);

    const [settings, setSettings] =
        useState<GameSettings>(getSavedSettings);

    const pausedRef = useRef(paused);
    const musicVolumeRef = useRef(settings.musicVolume);
    const sfxVolumeRef = useRef(settings.sfxVolume);
    const musicMutedRef = useRef(settings.musicMuted);
    const sfxMutedRef = useRef(settings.sfxMuted);

    // Keep values accessible inside the game loop and audio callbacks.
    pausedRef.current = paused;
    musicVolumeRef.current = settings.musicVolume;
    sfxVolumeRef.current = settings.sfxVolume;
    musicMutedRef.current = settings.musicMuted;
    sfxMutedRef.current = settings.sfxMuted;

    /* ------------------------------------------------------------------ */
    /* Audio                                                               */
    /* ------------------------------------------------------------------ */

    useEffect(() => {
        const audio = new Audio("/assets/sounds/background/flyBg.mp3");

        audio.loop = true;
        audio.preload = "auto";

        audioRef.current = audio;

        const removeListeners = () => {
            document.removeEventListener("pointerdown", tryPlay);
            document.removeEventListener("keydown", tryPlay);
        };

        function tryPlay() {
            if (pausedRef.current || musicMutedRef.current) return;

            audio.volume = musicVolumeRef.current / 100;

            audio.play()
                .then(removeListeners)
                .catch(() => {});
        }

        tryPlay();

        document.addEventListener("pointerdown", tryPlay);
        document.addEventListener("keydown", tryPlay);

        return () => {
            removeListeners();
            audio.pause();
            audio.currentTime = 0;
            audio.src = "";
            audioRef.current = null;
        };
    }, []);

    useEffect(() => {
        const audio = new Audio("/assets/sounds/blast.mp3");

        audio.preload = "auto";
        blastAudioRef.current = audio;

        return () => {
            audio.pause();
            audio.src = "";
            blastAudioRef.current = null;
        };
    }, []);

    // Music pause, mute and volume control.
    useEffect(() => {
        const audio = audioRef.current;

        if (!audio) return;

        audio.volume = settings.musicVolume / 100;

        if (paused || settings.musicMuted || settings.musicVolume === 0) {
            audio.pause();
        } else {
            audio.play().catch(() => {});
        }
    }, [
        paused,
        settings.musicVolume,
        settings.musicMuted,
        runId
    ]);

    const playBlastSound = () => {
        if (sfxMutedRef.current || sfxVolumeRef.current <= 0) return;

        const originalAudio = blastAudioRef.current;

        if (!originalAudio) return;

        const sound = originalAudio.cloneNode() as HTMLAudioElement;

        sound.volume = sfxVolumeRef.current / 100;

        sound.play().catch(() => {});
    };

    /* ------------------------------------------------------------------ */
    /* Settings                                                            */
    /* ------------------------------------------------------------------ */

    const updateSettings = (updates: Partial<GameSettings>) => {
        setSettings((current) => {
            const next = {
                ...current,
                ...updates
            };

            try {
                localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
            } catch {
                // Settings still work for the current session.
            }

            return next;
        });
    };

    /* ------------------------------------------------------------------ */
    /* Screen Shake                                                        */
    /* ------------------------------------------------------------------ */

    const shakeScreen = () => {
        const container = containerRef.current;

        if (!container) return;

        container.classList.remove("screen-shake");

        void container.offsetWidth;

        container.classList.add("screen-shake");
    };

    /* ------------------------------------------------------------------ */
    /* High Score                                                          */
    /* ------------------------------------------------------------------ */

    const saveHighScore = (score: number) => {
        if (score <= highScoreRef.current) return;

        highScoreRef.current = score;
        setHighScore(score);

        try {
            localStorage.setItem(HIGH_SCORE_KEY, String(score));
        } catch {
            // Game can continue if localStorage is unavailable.
        }
    };

    /* ------------------------------------------------------------------ */
    /* Mobile Joystick                                                     */
    /* ------------------------------------------------------------------ */

    const updateJoystick = (clientX: number, clientY: number) => {
        const joystick = joystickRef.current;
        const knob = joystickKnobRef.current;

        if (!joystick || !knob) return;

        const rect = joystick.getBoundingClientRect();

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let dx = clientX - centerX;
        let dy = clientY - centerY;

        const distance = Math.hypot(dx, dy);
        const maxDistance = JOYSTICK_RADIUS;

        if (distance > maxDistance) {
            dx = (dx / distance) * maxDistance;
            dy = (dy / distance) * maxDistance;
        }

        joystickVectorRef.current = {
            x: dx / maxDistance,
            y: dy / maxDistance
        };

        knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };

    const handleJoystickDown = (
        e: ReactPointerEvent<HTMLDivElement>
    ) => {
        if (paused || status === "over") return;

        e.preventDefault();
        e.stopPropagation();

        joystickActiveRef.current = true;
        joystickPointerIdRef.current = e.pointerId;

        e.currentTarget.setPointerCapture(e.pointerId);

        updateJoystick(e.clientX, e.clientY);
    };

    const handleJoystickMove = (
        e: ReactPointerEvent<HTMLDivElement>
    ) => {
        if (!joystickActiveRef.current) return;
        if (joystickPointerIdRef.current !== e.pointerId) return;

        e.preventDefault();
        e.stopPropagation();

        updateJoystick(e.clientX, e.clientY);
    };

    const resetJoystick = () => {
        joystickActiveRef.current = false;
        joystickPointerIdRef.current = null;

        joystickVectorRef.current = {
            x: 0,
            y: 0
        };

        if (joystickKnobRef.current) {
            joystickKnobRef.current.style.transform =
                "translate(0px, 0px)";
        }
    };

    const handleJoystickUp = (
        e: ReactPointerEvent<HTMLDivElement>
    ) => {
        if (joystickPointerIdRef.current !== e.pointerId) return;

        resetJoystick();
    };

    /* ------------------------------------------------------------------ */
    /* Lock Page Scrolling                                                 */
    /* ------------------------------------------------------------------ */

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        const previousOverscroll = document.body.style.overscrollBehavior;

        document.body.style.overflow = "hidden";
        document.body.style.overscrollBehavior = "none";

        return () => {
            document.body.style.overflow = previousOverflow;
            document.body.style.overscrollBehavior = previousOverscroll;
        };
    }, []);

    /* ------------------------------------------------------------------ */
    /* Game Loop                                                           */
    /* ------------------------------------------------------------------ */

    useEffect(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        const rocketLayer = rocketLayerRef.current;
        const planeEl = planeRef.current;
        const flashEl = flashRef.current;

        if (!container || !canvas || !rocketLayer || !planeEl || !flashEl) {
            return;
        }

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const random = (min: number, max: number) =>
            Math.random() * (max - min) + min;

        const clamp = (value: number, min: number, max: number) =>
            Math.min(max, Math.max(min, value));

        const normalizeAngle = (angle: number) =>
            Math.atan2(Math.sin(angle), Math.cos(angle));

        const smooth = (k: number, dt: number) =>
            1 - Math.pow(1 - k, dt);

        /* ---------------------------- Sizes ---------------------------- */

        let width = 0;
        let height = 0;

        let planeSize = 56;
        let rocketSize = 56;

        const plane = {
            x: 0,
            y: 0,
            heading: -Math.PI / 2,
            turnVel: 0,
            bank: 0
        };

        const bounds = () => {
            const pad = planeSize / 2;
            const top = width < 768 ? 90 : 100;

            return {
                minX: pad,
                maxX: width - pad,
                minY: top + pad,
                maxY: height - pad
            };
        };

        const rockets: RocketObj[] = [];
        const particles: Particle[] = [];
        const trail: Point[] = [];

        const resize = () => {
            width = container.clientWidth;
            height = container.clientHeight;

            const dpr = window.devicePixelRatio || 1;
            const mobile = width < 768;

            planeSize = mobile ? 44 : 56;
            rocketSize = mobile ? 40 : 56;

            planeEl.style.width = `${planeSize}px`;
            planeEl.style.height = `${planeSize}px`;

            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);

            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const b = bounds();

            plane.x = clamp(plane.x, b.minX, b.maxX);
            plane.y = clamp(plane.y, b.minY, b.maxY);

            for (const rocket of rockets) {
                rocket.el.style.width = `${rocketSize}px`;
                rocket.el.style.height = `${rocketSize}px`;
            }
        };

        /* ---------------------------- State ---------------------------- */

        let elapsed = 0;
        let lastSecond = 0;

        let spawnTimer = 1800;
        let invuln = 0;

        let lives = MAX_LIVES;
        let over = false;

        resize();

        plane.x = width / 2;
        plane.y = height * 0.82;

        planeEl.style.opacity = "1";

        /* ---------------------------- Input ---------------------------- */

        const pointer = {
            x: 0,
            y: 0
        };

        let mode: Mode = "idle";

        const keys = new Set<string>();

        const KEY_NAMES = new Set([
            "w", "a", "s", "d",
            "arrowup", "arrowdown",
            "arrowleft", "arrowright"
        ]);

        // Native browser PointerEvent, not React's generic PointerEvent.
        const onPointerMove = (e: globalThis.PointerEvent) => {
            if (joystickActiveRef.current || pausedRef.current) return;

            pointer.x = e.clientX;
            pointer.y = e.clientY;

            mode = "pointer";
        };

        const onKeyDown = (e: KeyboardEvent) => {
            const key = e.key.toLowerCase();

            if (key === "escape" && !over) {
                setPaused((current) => !current);
                setShowSettings(false);
                resetJoystick();
                return;
            }

            if (!KEY_NAMES.has(key) || pausedRef.current) return;

            e.preventDefault();

            keys.add(key);
            mode = "keys";
        };

        const onKeyUp = (e: KeyboardEvent) => {
            keys.delete(e.key.toLowerCase());
        };

        const onBlur = () => {
            keys.clear();
            resetJoystick();
        };

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerdown", onPointerMove);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        window.addEventListener("resize", resize);

        /* --------------------------- Particles --------------------------- */

        const addParticle = (particle: Particle) => {
            if (particles.length < 450) {
                particles.push(particle);
            }
        };

        const explode = (x: number, y: number, count: number) => {
            for (let i = 0; i < count; i++) {
                const angle = random(0, Math.PI * 2);
                const speed = random(0.8, 4.2);

                addParticle({
                    x,
                    y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: random(22, 42),
                    max: 42,
                    size: random(3, 7),
                    grow: -0.04,
                    alpha: 0.9,
                    color:
                        Math.random() < 0.5
                            ? "251, 146, 60"
                            : "250, 204, 21"
                });
            }
        };

        const flashScreen = () => {
            flashEl.classList.remove("hit-flash");

            void flashEl.offsetWidth;

            flashEl.classList.add("hit-flash");
        };

        /* ---------------------------- Rockets ---------------------------- */

        const spawnRocket = () => {
            if (rockets.length >= MAX_ROCKETS) return;

            const level = 1 + Math.floor(elapsed / SECONDS_PER_LEVEL);

            const minDist = width < 768 ? 200 : SAFE_SPAWN_DISTANCE;
            const margin = 60;

            let sx = 0;
            let sy = 0;

            // Choose a random screen edge.
            for (let tries = 0; tries < 12; tries++) {
                switch (Math.floor(Math.random() * 4)) {
                    case 0:
                        sx = random(0, width);
                        sy = -margin;
                        break;

                    case 1:
                        sx = random(0, width);
                        sy = height + margin;
                        break;

                    case 2:
                        sx = -margin;
                        sy = random(0, height);
                        break;

                    default:
                        sx = width + margin;
                        sy = random(0, height);
                }

                if (Math.hypot(sx - plane.x, sy - plane.y) > minDist) {
                    break;
                }
            }

            const el = document.createElement("div");

            el.style.cssText =
                `position:absolute;top:0;left:0;` +
                `width:${rocketSize}px;height:${rocketSize}px;` +
                `will-change:transform;pointer-events:none;`;

            const img = document.createElement("img");

            img.src = Rocket;
            img.alt = "";
            img.draggable = false;

            img.style.cssText =
                "width:100%;height:100%;object-fit:contain;";

            el.appendChild(img);
            rocketLayer.appendChild(el);

            const targetAngle = Math.atan2(
                plane.y - sy,
                plane.x - sx
            );

            // Random initial direction prevents identical rocket paths.
            const initialHeading = targetAngle + random(-0.55, 0.55);

            // Speed increases gradually with level, with a maximum.
            const baseSpeed = Math.min(
                8.5,
                4.2 + (level - 1) * 0.35
            );

            rockets.push({
                el,
                x: sx,
                y: sy,
                heading: initialHeading,
                speed: baseSpeed * random(0.92, 1.12),
                turn: random(0.016, 0.026),
                age: 0,
                puff: 0
            });
        };

        const removeRocket = (index: number) => {
            const rocket = rockets[index];

            if (!rocket) return;

            rocket.el.remove();
            rockets.splice(index, 1);
        };

        /* --------------------------- Flight Trail --------------------------- */

        const getTail = (): Point => {
            const scale = planeSize / TRAIL_BASE_SIZE;

            return {
                x: plane.x - Math.cos(plane.heading) * TAIL_OFFSET * scale,
                y: plane.y - Math.sin(plane.heading) * TAIL_OFFSET * scale
            };
        };

        const drawFlightLines = () => {
            const points = [...trail, getTail()];
            const count = points.length;

            if (count < 2) return;

            const scale = planeSize / TRAIL_BASE_SIZE;

            const nx = new Array<number>(count);
            const ny = new Array<number>(count);

            for (let i = 0; i < count; i++) {
                const p0 = points[Math.max(0, i - 2)];
                const p1 = points[Math.min(count - 1, i + 2)];

                const dx = p1.x - p0.x;
                const dy = p1.y - p0.y;

                const length = Math.hypot(dx, dy) || 1;

                nx[i] = -dy / length;
                ny[i] = dx / length;
            }

            ctx.lineCap = "butt";
            ctx.lineJoin = "round";

            for (const line of TRAIL_LINES) {
                const xs = new Array<number>(count);
                const ys = new Array<number>(count);

                for (let i = 0; i < count; i++) {
                    xs[i] = points[i].x + nx[i] * line.offset * scale;
                    ys[i] = points[i].y + ny[i] * line.offset * scale;
                }

                for (let pass = 0; pass < 2; pass++) {
                    const isGlow = pass === 0;

                    for (let i = 1; i < count; i++) {
                        const t = i / (count - 1);

                        const fade = Math.pow(t, 1.6);
                        const taper = 0.35 + 0.65 * t;

                        const alpha =
                            fade * line.alpha * (isGlow ? 0.2 : 0.95);

                        if (alpha < 0.005) continue;

                        ctx.beginPath();
                        ctx.moveTo(xs[i - 1], ys[i - 1]);
                        ctx.lineTo(xs[i], ys[i]);

                        ctx.lineWidth =
                            line.width *
                            Math.max(1, scale * 0.7) *
                            taper *
                            (isGlow ? 3.8 : 1);

                        ctx.strokeStyle = `rgba(${line.color}, ${alpha})`;
                        ctx.stroke();
                    }
                }
            }
        };

        /* ----------------------------- Frame ----------------------------- */

        let prev = 0;
        let raf = 0;

        const frame = (now: number) => {
            if (!prev) prev = now;

            const dtMs = Math.min(now - prev, 50);
            prev = now;

            // Keep the animation loop alive while paused,
            // but do not advance the game or its timers.
            if (pausedRef.current) {
                raf = requestAnimationFrame(frame);
                return;
            }

            const dt = dtMs / 16.667;

            elapsed += dtMs / 1000;
            invuln = Math.max(0, invuln - dtMs);

            /* ---------------------------------------------------------- */
            /* Plane Steering                                             */
            /* ---------------------------------------------------------- */

            const b = bounds();

            let targetHeading = plane.heading;
            let orbit = true;

            if (joystickActiveRef.current) {
                const joystick = joystickVectorRef.current;

                if (Math.hypot(joystick.x, joystick.y) > 0.12) {
                    targetHeading = Math.atan2(joystick.y, joystick.x);
                    orbit = false;
                }
            } else if (mode === "pointer") {
                const dx = pointer.x - plane.x;
                const dy = pointer.y - plane.y;

                if (Math.hypot(dx, dy) > 30) {
                    targetHeading = Math.atan2(dy, dx);
                    orbit = false;
                }
            } else if (mode === "keys") {
                const kx =
                    (keys.has("d") || keys.has("arrowright") ? 1 : 0) -
                    (keys.has("a") || keys.has("arrowleft") ? 1 : 0);

                const ky =
                    (keys.has("s") || keys.has("arrowdown") ? 1 : 0) -
                    (keys.has("w") || keys.has("arrowup") ? 1 : 0);

                if (kx || ky) {
                    targetHeading = Math.atan2(ky, kx);
                    orbit = false;
                }
            }

            const cos = Math.cos(plane.heading);
            const sin = Math.sin(plane.heading);

            const nearEdge =
                (plane.x < b.minX + 60 && cos < 0) ||
                (plane.x > b.maxX - 60 && cos > 0) ||
                (plane.y < b.minY + 60 && sin < 0) ||
                (plane.y > b.maxY - 60 && sin > 0);

            if (nearEdge) {
                targetHeading = Math.atan2(
                    (b.minY + b.maxY) / 2 - plane.y,
                    width / 2 - plane.x
                );

                orbit = false;
            }

            const desiredTurn = orbit
                ? IDLE_TURN
                : clamp(
                    normalizeAngle(targetHeading - plane.heading) * 2.5,
                    -MAX_TURN,
                    MAX_TURN
                );

            plane.turnVel +=
                (desiredTurn - plane.turnVel) * smooth(0.12, dt);

            plane.heading = normalizeAngle(
                plane.heading + plane.turnVel * dt
            );

            const speed = width < 768 ? PLANE_SPEED * 0.8 : PLANE_SPEED;

            plane.x = clamp(
                plane.x + Math.cos(plane.heading) * speed * dt,
                b.minX,
                b.maxX
            );

            plane.y = clamp(
                plane.y + Math.sin(plane.heading) * speed * dt,
                b.minY,
                b.maxY
            );

            const targetBank = (plane.turnVel / MAX_TURN) * MAX_BANK;

            plane.bank +=
                (targetBank - plane.bank) * smooth(0.08, dt);

            /* ---------------------------------------------------------- */
            /* Plane Transform                                            */
            /* ---------------------------------------------------------- */

            const rotation =
                (plane.heading * 180) / Math.PI + PLANE_NOSE_OFFSET_DEG;

            const engine = 1 + Math.sin(elapsed * 45) * 0.015;

            planeEl.style.transform =
                `translate3d(${plane.x - planeSize / 2}px, ${plane.y - planeSize / 2}px, 0) ` +
                `rotate(${rotation}deg) scale(${engine}) ` +
                `perspective(300px) rotateY(${plane.bank}deg)`;

            planeEl.style.opacity =
                invuln > 0 && Math.floor(invuln / 90) % 2 === 0
                    ? "0.35"
                    : "1";

            /* ---------------------------------------------------------- */
            /* Flight Trail                                               */
            /* ---------------------------------------------------------- */

            const tail = getTail();
            const last = trail[trail.length - 1];

            if (
                !last ||
                Math.hypot(tail.x - last.x, tail.y - last.y) >= TRAIL_SPACING
            ) {
                trail.push(tail);

                if (trail.length > MAX_TRAIL_POINTS) {
                    trail.shift();
                }
            }

            /* ---------------------------------------------------------- */
            /* Rocket Spawning                                            */
            /* ---------------------------------------------------------- */

            spawnTimer -= dtMs;

            if (spawnTimer <= 0) {
                if (rockets.length < MAX_ROCKETS) {
                    spawnRocket();
                }

                const level = 1 + Math.floor(elapsed / SECONDS_PER_LEVEL);

                // A controlled spawn interval. It gets slightly shorter
                // with level, but never becomes excessively fast.
                const baseInterval = Math.max(
                    1250,
                    2100 - (level - 1) * 75
                );

                spawnTimer = baseInterval * random(0.85, 1.2);
            }

            /* ---------------------------------------------------------- */
            /* Move Rockets                                               */
            /* ---------------------------------------------------------- */

            for (let i = rockets.length - 1; i >= 0; i--) {
                const rocket = rockets[i];

                rocket.age += dtMs;

                const diff = normalizeAngle(
                    Math.atan2(plane.y - rocket.y, plane.x - rocket.x) -
                    rocket.heading
                );

                rocket.heading = normalizeAngle(
                    rocket.heading +
                    clamp(diff, -rocket.turn, rocket.turn) * dt
                );

                rocket.x += Math.cos(rocket.heading) * rocket.speed * dt;
                rocket.y += Math.sin(rocket.heading) * rocket.speed * dt;

                rocket.el.style.transform =
                    `translate3d(${rocket.x - rocketSize / 2}px, ${rocket.y - rocketSize / 2}px, 0) ` +
                    `rotate(${(rocket.heading * 180) / Math.PI + ROCKET_NOSE_OFFSET_DEG}deg)`;

                rocket.puff += dt;

                if (rocket.puff >= 2) {
                    rocket.puff = 0;

                    addParticle({
                        x:
                            rocket.x -
                            Math.cos(rocket.heading) * rocketSize * 0.4,
                        y:
                            rocket.y -
                            Math.sin(rocket.heading) * rocketSize * 0.4,
                        vx: random(-0.2, 0.2),
                        vy: random(-0.2, 0.2),
                        life: 20,
                        max: 20,
                        size: random(2.5, 4),
                        grow: 0.08,
                        alpha: 0.6,
                        color:
                            Math.random() < 0.5
                                ? "253, 186, 116"
                                : "148, 163, 184"
                    });
                }
            }

            /* ---------------------------------------------------------- */
            /* Rocket vs Rocket Collision                                 */
            /* ---------------------------------------------------------- */

            const rocketCollisionRadius = rocketSize * 0.55;

            for (let i = rockets.length - 1; i >= 0; i--) {
                const rocketA = rockets[i];

                if (!rocketA) continue;

                for (let j = i - 1; j >= 0; j--) {
                    const rocketB = rockets[j];

                    if (!rocketB) continue;

                    const distance = Math.hypot(
                        rocketA.x - rocketB.x,
                        rocketA.y - rocketB.y
                    );

                    if (distance < rocketCollisionRadius) {
                        const explosionX = (rocketA.x + rocketB.x) / 2;
                        const explosionY = (rocketA.y + rocketB.y) / 2;

                        removeRocket(i);
                        removeRocket(j);

                        explode(explosionX, explosionY, 45);

                        playBlastSound();
                        shakeScreen();

                        // Restore one heart, maximum 3.
                        if (!over && lives < MAX_LIVES) {
                            lives = Math.min(MAX_LIVES, lives + 1);

                            setStats((s) => ({
                                ...s,
                                lives
                            }));
                        }

                        break;
                    }
                }
            }

            /* ---------------------------------------------------------- */
            /* Rocket vs Player Collision                                 */
            /* ---------------------------------------------------------- */

            const hitRadius =
                planeSize * 0.28 + rocketSize * 0.28;

            for (let i = rockets.length - 1; i >= 0; i--) {
                const rocket = rockets[i];

                if (
                    Math.hypot(
                        rocket.x - plane.x,
                        rocket.y - plane.y
                    ) < hitRadius
                ) {
                    explode(rocket.x, rocket.y, 25);
                    removeRocket(i);

                    playBlastSound();

                    if (invuln <= 0 && !over) {
                        lives = Math.max(0, lives - 1);

                        invuln = HIT_COOLDOWN_MS;

                        flashScreen();
                        shakeScreen();

                        const finalScore =
                            Math.floor(elapsed) * POINTS_PER_SECOND;

                        setStats((s) => ({
                            ...s,
                            score: finalScore,
                            time: Math.floor(elapsed),
                            level:
                                1 + Math.floor(elapsed / SECONDS_PER_LEVEL),
                            lives
                        }));

                        saveHighScore(finalScore);

                        if (lives <= 0) {
                            over = true;

                            explode(plane.x, plane.y, 50);

                            planeEl.style.opacity = "0";

                            setStatus("over");
                        }
                    }

                    continue;
                }

                if (
                    rocket.age > ROCKET_LIFETIME_MS ||
                    rocket.x < -200 ||
                    rocket.x > width + 200 ||
                    rocket.y < -200 ||
                    rocket.y > height + 200
                ) {
                    removeRocket(i);
                }
            }

            /* ---------------------------------------------------------- */
            /* Score / Time / Level                                       */
            /* ---------------------------------------------------------- */

            const sec = Math.floor(elapsed);

            if (sec !== lastSecond) {
                lastSecond = sec;

                const currentScore = sec * POINTS_PER_SECOND;

                setStats((s) => ({
                    ...s,
                    score: currentScore,
                    time: sec,
                    level: 1 + Math.floor(sec / SECONDS_PER_LEVEL)
                }));

                saveHighScore(currentScore);
            }

            /* ---------------------------------------------------------- */
            /* Draw Trail and Particles                                   */
            /* ---------------------------------------------------------- */

            ctx.clearRect(0, 0, width, height);

            drawFlightLines();

            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];

                p.life -= dt;

                if (p.life <= 0) {
                    particles[i] = particles[particles.length - 1];
                    particles.pop();
                    continue;
                }

                p.x += p.vx * dt;
                p.y += p.vy * dt;

                p.size = Math.max(0.1, p.size + p.grow * dt);

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);

                ctx.fillStyle =
                    `rgba(${p.color}, ${(p.life / p.max) * p.alpha})`;

                ctx.fill();
            }

            if (!over) {
                raf = requestAnimationFrame(frame);
            }
        };

        raf = requestAnimationFrame(frame);

        /* ---------------------------- Cleanup ---------------------------- */

        return () => {
            cancelAnimationFrame(raf);

            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerdown", onPointerMove);
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("resize", resize);

            resetJoystick();

            rocketLayer.innerHTML = "";

            rockets.length = 0;
            particles.length = 0;
            trail.length = 0;
        };
    }, [runId]);

    /* ------------------------------------------------------------------ */
    /* Pause / Resume / Restart                                            */
    /* ------------------------------------------------------------------ */

    const pauseGame = () => {
        resetJoystick();
        setPaused(true);
        setShowSettings(false);
    };

    const resumeGame = () => {
        setShowSettings(false);
        setPaused(false);
    };

    const restart = () => {
        resetJoystick();

        setPaused(false);
        setShowSettings(false);

        setStats(INITIAL_STATS);
        setStatus("playing");

        setRunId((id) => id + 1);
    };

    /* ------------------------------------------------------------------ */
    /* UI                                                                  */
    /* ------------------------------------------------------------------ */

    return (
        <div
            ref={containerRef}
            className="fixed inset-0 overflow-hidden touch-none select-none bg-sky-50"
        >
            <style>{`
                @keyframes hitFlash { from { opacity: 0.45; } to { opacity: 0; } }
                @keyframes hudAppear {
                    from { opacity: 0; transform: translate(-50%, -12px); }
                    to { opacity: 1; transform: translate(-50%, 0); }
                }
                @keyframes joystickPulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(59,130,246,0.18); }
                    50% { box-shadow: 0 0 0 12px rgba(59,130,246,0); }
                }
                @keyframes screenShake {
                    0% { transform: translate(0, 0); }
                    15% { transform: translate(-8px, 5px); }
                    30% { transform: translate(7px, -6px); }
                    45% { transform: translate(-6px, -4px); }
                    60% { transform: translate(6px, 5px); }
                    75% { transform: translate(-3px, 2px); }
                    100% { transform: translate(0, 0); }
                }
                @keyframes cloudDrift {
                    from { transform: translateX(-280px); }
                    to { transform: translateX(110vw); }
                }
                .cloud-drift {
                    animation-name: cloudDrift;
                    animation-timing-function: linear;
                    animation-iteration-count: infinite;
                }
                .screen-shake { animation: screenShake 0.4s ease-in-out; }
                .hit-flash { animation: hitFlash 0.45s ease-out forwards; }
                .game-hud { animation: hudAppear 0.5s ease-out; }
                .joystick-base { animation: joystickPulse 3s ease-in-out infinite; }
                .game-slider { accent-color: #3b82f6; cursor: pointer; }
                @media (prefers-reduced-motion: reduce) {
                    .joystick-base, .screen-shake, .game-hud { animation: none !important; }
                    .cloud-drift { animation: none !important; transform: translateX(15vw); }
                }
            `}</style>

            {/* Background decorations (same family as the start screen) */}

            <div className="absolute -top-36 -left-36 w-96 h-96 rounded-full border-2 border-dashed border-blue-300 opacity-60 pointer-events-none z-0" />
            <div className="absolute -bottom-36 -right-36 w-80 h-80 rounded-full border-2 border-dashed border-blue-300 opacity-60 pointer-events-none z-0" />
            <div className="absolute top-32 right-20 w-32 h-32 rounded-full bg-blue-100/60 blur-2xl pointer-events-none z-0" />
            <div className="absolute bottom-24 left-20 w-40 h-40 rounded-full bg-sky-200/50 blur-3xl pointer-events-none z-0" />

            {/* Dotted-outline clouds */}
            <Clouds />

            {/* Trails and explosions */}

            <canvas
                ref={canvasRef}
                className="absolute top-0 left-0 pointer-events-none z-[5]"
            />

            {/* Rockets */}

            <div
                ref={rocketLayerRef}
                className="absolute inset-0 pointer-events-none z-[6]"
            />

            {/* Player plane */}

            <div
                ref={planeRef}
                className="absolute top-0 left-0 pointer-events-none z-[7] will-change-transform"
                style={{
                    width: 56,
                    height: 56,
                    transformOrigin: "center center",
                    transform: "translate3d(-999px, -999px, 0)"
                }}
            >
                <img
                    src={Plane}
                    alt="Player airplane"
                    draggable={false}
                    className="w-full h-full object-contain"
                />
            </div>

            {/* Damage flash */}

            <div
                ref={flashRef}
                className="absolute inset-0 bg-red-400 opacity-0 pointer-events-none z-[8]"
            />

            {/* HUD */}

            <div className="game-hud absolute top-3 sm:top-5 left-1/2 -translate-x-1/2 w-[94%] sm:w-[88%] max-w-3xl z-20">
                <div className="grid grid-cols-4 items-center rounded-2xl border border-blue-200 bg-white/85 backdrop-blur-xl shadow-lg shadow-blue-200/50 px-2 sm:px-5 py-3 sm:py-4">
                    <div className="text-center min-w-0">
                        <p className="text-[9px] sm:text-[10px] font-bold tracking-[0.16em] text-blue-400">
                            SCORE
                        </p>
                        <p className="text-base sm:text-2xl font-black text-blue-600 tabular-nums">
                            {String(stats.score).padStart(4, "0")}
                        </p>
                    </div>

                    <div className="text-center min-w-0 border-l border-blue-100">
                        <p className="text-[9px] sm:text-[10px] font-bold tracking-[0.16em] text-amber-500">
                            BEST
                        </p>
                        <p className="text-base sm:text-2xl font-black text-amber-500 tabular-nums">
                            {String(highScore).padStart(4, "0")}
                        </p>
                    </div>

                    <div className="text-center min-w-0 border-l border-blue-100">
                        <p className="text-[9px] sm:text-[10px] font-bold tracking-[0.16em] text-blue-400">
                            TIME
                        </p>
                        <p className="text-base sm:text-2xl font-black text-slate-700 tabular-nums">
                            {formatTime(stats.time)}
                        </p>
                    </div>

                    <div className="text-center min-w-0 border-l border-blue-100">
                        <p className="text-[9px] sm:text-[10px] font-bold tracking-[0.16em] text-blue-400">
                            LEVEL
                        </p>
                        <p className="text-base sm:text-2xl font-black text-slate-700 tabular-nums">
                            {String(stats.level).padStart(2, "0")}
                        </p>
                    </div>
                </div>

                {/* Lives */}

                <div className="flex justify-center mt-2">
                    <div className="flex items-center gap-3 rounded-full border border-blue-200 bg-blue-100/90 backdrop-blur-xl px-4 py-1.5 shadow-md shadow-blue-200/40">
                        <span className="text-[10px] font-bold tracking-[0.18em] text-blue-500">
                            LIVES
                        </span>

                        <div className="flex items-center gap-1.5">
                            {Array.from({ length: MAX_LIVES }, (_, index) => (
                                <span
                                    key={index}
                                    className={`text-lg leading-none transition-all duration-300 ${
                                        index < stats.lives
                                            ? "text-red-500 drop-shadow-[0_0_4px_rgba(239,68,68,0.5)]"
                                            : "text-blue-200"
                                    }`}
                                >
                                    ♥
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Pause button */}

            {status === "playing" && (
                <button
                    onClick={pauseGame}
                    aria-label="Pause game"
                    className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-blue-200 bg-white/85 text-blue-500 shadow-lg shadow-blue-200/50 backdrop-blur-xl transition hover:bg-blue-500 hover:text-white hover:-translate-y-0.5 active:scale-95"
                >
                    <svg
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <rect x="6" y="4" width="4" height="16" rx="1" />
                        <rect x="14" y="4" width="4" height="16" rx="1" />
                    </svg>
                </button>
            )}

            {/* Desktop controls hint */}

            <div className="hidden md:flex absolute bottom-6 left-1/2 -translate-x-1/2 z-20 items-center gap-3 rounded-full border border-blue-200 bg-blue-100/80 backdrop-blur-xl px-5 py-2 text-blue-500 text-xs font-bold tracking-[0.15em] pointer-events-none">
                <span>MOVE MOUSE TO STEER</span>
                <span className="h-1 w-1 rounded-full bg-blue-300" />
                <span>W A S D / ARROWS</span>
            </div>

            {/* Mobile joystick */}

            <div className="md:hidden absolute bottom-7 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
                <p className="text-[10px] font-bold tracking-[0.2em] text-blue-400">
                    DRAG TO STEER
                </p>

                <div
                    ref={joystickRef}
                    onPointerDown={handleJoystickDown}
                    onPointerMove={handleJoystickMove}
                    onPointerUp={handleJoystickUp}
                    onPointerCancel={handleJoystickUp}
                    onLostPointerCapture={handleJoystickUp}
                    className="joystick-base relative flex items-center justify-center w-32 h-32 rounded-full border-2 border-dashed border-blue-300 bg-white/70 backdrop-blur-xl shadow-lg shadow-blue-200/50 touch-none select-none"
                    style={{ touchAction: "none" }}
                >
                    <div className="absolute inset-3 rounded-full border border-blue-200" />

                    <div className="absolute top-3 left-1/2 -translate-x-1/2 text-blue-300 text-[10px]">▲</div>
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-blue-300 text-[10px]">▼</div>
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-300 text-[10px]">◀</div>
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-300 text-[10px]">▶</div>

                    <div
                        ref={joystickKnobRef}
                        className="relative z-10 w-12 h-12 rounded-full bg-blue-500 shadow-lg shadow-blue-400/50 pointer-events-none"
                        style={{ transform: "translate(0px, 0px)" }}
                    >
                        <div className="absolute inset-2 rounded-full bg-blue-400" />
                    </div>
                </div>
            </div>

            {/* Pause / Settings overlay */}

            {paused && status === "playing" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-sky-100/60 backdrop-blur-md px-5">
                    <div className="w-full max-w-sm rounded-3xl border border-white/80 bg-white/95 p-6 sm:p-8 shadow-2xl shadow-sky-900/15">
                        {!showSettings ? (
                            <>
                                <div className="text-center">
                                    <div className="mx-auto mb-4 inline-block px-5 py-2 rounded-full bg-blue-100 border border-blue-200">
                                        <span className="text-blue-500 text-xs font-bold tracking-[3px]">
                                            ✈ GAME PAUSED
                                        </span>
                                    </div>

                                    <h2 className="text-4xl font-black tracking-tight text-blue-400">
                                        TAKE A <span className="text-blue-600">BREAK</span>
                                    </h2>

                                    <p className="mt-2 text-sm text-slate-500">
                                        Your flight is safely paused.
                                    </p>
                                </div>

                                <div className="mt-7 space-y-3">
                                    <button
                                        onClick={resumeGame}
                                        className="group w-full flex items-center justify-center gap-3 rounded-full bg-blue-500 px-8 py-3.5 font-bold text-white shadow-lg shadow-blue-300/50 transition-all duration-300 hover:bg-blue-600 hover:-translate-y-0.5"
                                    >
                                        <span>RESUME</span>
                                        <span className="transition-transform group-hover:translate-x-1">➜</span>
                                    </button>

                                    <button
                                        onClick={() => setShowSettings(true)}
                                        className="w-full rounded-full border border-blue-200 bg-blue-50 px-8 py-3.5 font-bold text-blue-500 transition hover:bg-blue-100 active:scale-[0.98]"
                                    >
                                        SETTINGS
                                    </button>

                                    <button
                                        onClick={restart}
                                        className="w-full rounded-full border border-slate-200 bg-white px-8 py-3.5 font-bold text-slate-500 transition hover:bg-slate-50 active:scale-[0.98]"
                                    >
                                        RESTART
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="flex items-center justify-between">
                                    <h2 className="text-3xl font-black tracking-tight text-blue-500">
                                        SETTINGS
                                    </h2>

                                    <button
                                        onClick={() => setShowSettings(false)}
                                        aria-label="Back to pause menu"
                                        className="flex h-9 w-9 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-500 transition hover:bg-blue-100"
                                    >
                                        <svg
                                            viewBox="0 0 24 24"
                                            className="h-5 w-5"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            aria-hidden="true"
                                        >
                                            <path d="m15 18-6-6 6-6" />
                                        </svg>
                                    </button>
                                </div>

                                <div className="mt-7">
                                    <SettingRow
                                        label="Music"
                                        value={settings.musicVolume}
                                        muted={settings.musicMuted}
                                        onVolume={(v) => updateSettings({ musicVolume: v })}
                                        onMute={(m) => updateSettings({ musicMuted: m })}
                                        icon={
                                            <svg
                                                viewBox="0 0 24 24"
                                                className="h-5 w-5"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="1.8"
                                                aria-hidden="true"
                                            >
                                                <path d="M9 18V5l12-2v13" />
                                                <circle cx="6" cy="18" r="3" />
                                                <circle cx="18" cy="16" r="3" />
                                            </svg>
                                        }
                                    />
                                </div>

                                <div className="my-6 border-t border-dashed border-blue-200" />

                                <SettingRow
                                    label="Sound Effects"
                                    value={settings.sfxVolume}
                                    muted={settings.sfxMuted}
                                    onVolume={(v) => updateSettings({ sfxVolume: v })}
                                    onMute={(m) => updateSettings({ sfxMuted: m })}
                                    icon={
                                        <svg
                                            viewBox="0 0 24 24"
                                            className="h-5 w-5"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            aria-hidden="true"
                                        >
                                            <path d="M11 5 6 9H3v6h3l5 4V5z" />
                                            <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                                            <path d="M19 5a10 10 0 0 1 0 14" />
                                        </svg>
                                    }
                                />

                                <button
                                    onClick={() => setShowSettings(false)}
                                    className="mt-7 w-full rounded-full bg-blue-500 px-8 py-3.5 font-bold text-white shadow-lg shadow-blue-300/50 transition hover:bg-blue-600 active:scale-[0.98]"
                                >
                                    DONE
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* Game Over */}

            {status === "over" && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-sky-100/60 backdrop-blur-md px-5">
                    <div className="w-full max-w-sm rounded-3xl border border-white/80 bg-white/95 p-6 sm:p-8 text-center shadow-2xl shadow-sky-900/15">
                        <div className="mx-auto mb-4 inline-block px-5 py-2 rounded-full bg-red-50 border border-red-100">
                            <span className="text-red-500 text-xs font-bold tracking-[3px]">
                                ✈ FLIGHT TERMINATED
                            </span>
                        </div>

                        <h2 className="text-5xl font-black tracking-tight text-blue-400">
                            GAME <span className="text-blue-600">OVER</span>
                        </h2>

                        <p className="mt-2 text-sm text-slate-500">
                            Your flight has ended. Ready to fly again?
                        </p>

                        <div className="mt-7 rounded-2xl border border-blue-100 bg-blue-50/80 py-5">
                            <p className="text-[10px] font-bold tracking-[0.2em] text-blue-500">
                                YOUR SCORE
                            </p>
                            <p className="mt-1 text-4xl font-black text-slate-800 tabular-nums">
                                {stats.score}
                            </p>
                        </div>

                        <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                            <div className="text-left">
                                <p className="text-[10px] font-bold tracking-wider text-amber-600">
                                    BEST SCORE
                                </p>
                                <p className="text-xl font-black text-amber-700 tabular-nums">
                                    {highScore}
                                </p>
                            </div>

                            {stats.score >= highScore && stats.score > 0 && (
                                <div className="rounded-full bg-amber-400 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-950">
                                    New Record!
                                </div>
                            )}
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-slate-200 bg-slate-50 py-3">
                                <p className="text-[10px] font-bold tracking-widest text-slate-400">
                                    TIME
                                </p>
                                <p className="mt-1 text-xl font-bold text-slate-700 tabular-nums">
                                    {formatTime(stats.time)}
                                </p>
                            </div>

                            <div className="rounded-xl border border-slate-200 bg-slate-50 py-3">
                                <p className="text-[10px] font-bold tracking-widest text-slate-400">
                                    LEVEL
                                </p>
                                <p className="mt-1 text-xl font-bold text-slate-700">
                                    {stats.level}
                                </p>
                            </div>
                        </div>

                        <button
                            autoFocus
                            onClick={restart}
                            className="group mt-6 w-full flex items-center justify-center gap-3 rounded-full bg-blue-500 px-8 py-3.5 font-bold text-white shadow-lg shadow-blue-300/50 transition-all duration-300 hover:bg-blue-600 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                        >
                            <span>PLAY AGAIN</span>
                            <span className="transition-transform group-hover:translate-x-1">➜</span>
                        </button>

                        <p className="mt-4 text-[10px] tracking-widest text-blue-300">
                            YOUR BEST SCORE IS SAVED AUTOMATICALLY
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}