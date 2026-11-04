import { useEffect, useRef } from "react";
import Airplane from "../../public/assets/airplane.webp";
import { useNavigate } from "react-router";

type Point = {
    x: number;
    y: number;
};

/* ------------------------------------------------------------------ */
/* Tunable constants                                                   */
/* ------------------------------------------------------------------ */

// Rendered airplane size in px (must match the w-8 h-8 classes below)
const PLANE_SIZE = 32;

// The airplane image's nose points UP by default (-90deg in canvas math).
// Heading is measured with Math.atan2 (0 = pointing right), so we add 90deg
// exactly once, here, when writing the CSS rotation. If your artwork faces
// right instead, set this to 0.
const NOSE_OFFSET_DEG = 90;

// Distance from the plane's center back to its tail, where trails start
const TAIL_OFFSET = 12;

// Motion (units are "per 60fps frame"; scaled by delta time).
// Speed, turning and timing are re-randomised for every flight.
const SPEED_RANGE: [number, number] = [2.2, 4.2];
const MAX_TURN_RATE = 0.026; // rad / frame -> minimum turn radius ~115px
const MAX_BANK = 40; // degrees

// Random wandering: how long (frames) each steering "decision" lasts
const WANDER_DURATION: [number, number] = [40, 170];

// Pause (ms) offscreen between flights
const PAUSE_RANGE: [number, number] = [300, 3000];

// A plane counts as "off the page" once it's this far outside
const EXIT_MARGIN = 40;

// Trail
const TRAIL_SPACING = 3; // px between stored trail points
const MAX_TRAIL_POINTS = 150;

const TRAIL_LINES = [
    { offset: -6, width: 1.4, alpha: 0.65, color: "34, 211, 238" }, // cyan
    { offset: 0, width: 2.6, alpha: 1, color: "59, 130, 246" }, // bright blue (middle)
    { offset: 6, width: 1.4, alpha: 0.65, color: "96, 165, 250" } // light blue
];


export function StartGameview() {
    const navigate = useNavigate();
    useEffect(()=>{
        const audio = new Audio("/assets/sounds/background/menuBg.mp3");
        audio.loop = true;
        audio.volume = 0.1;

        const playMusic = ()=>{
            audio.play().catch(()=>{
                console.log("Waiting for user interaction");
            });
        }

        document.addEventListener("click",playMusic, {once:true});
        return()=>{
            audio.pause();
            audio.currentTime= 0;
            document.removeEventListener("click",playMusic);
        };
    },[]);
    
    const handlePlay = ()=>{
        const audio = new Audio("/assets/sounds/play.mp3");
        audio.play();

        audio.onended = () =>{
            navigate("/play");           
        };
    }

    const containerRef = useRef<HTMLDivElement>(null);
    const planeRef = useRef<HTMLDivElement>(null);
    const trailRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        const plane = planeRef.current;
        const canvas = trailRef.current;

        if (!container || !plane || !canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Plane and canvas share ONE coordinate system: the container's
        // CSS-pixel box. Both are positioned at its top-left origin.
        let width = container.clientWidth;
        let height = container.clientHeight;
        let dpr = window.devicePixelRatio || 1;

        const random = (min: number, max: number) =>
            Math.random() * (max - min) + min;

        const normalizeAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

        // Frame-rate independent smoothing factor
        const smooth = (k: number, dt: number) => 1 - Math.pow(1 - k, dt);

        const resize = () => {
            width = container.clientWidth;
            height = container.clientHeight;
            dpr = window.devicePixelRatio || 1;

            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        resize();
        window.addEventListener("resize", resize);

        const getEdgePoint = (): Point => {
            const edge = Math.floor(Math.random() * 4);
            const margin = 60;

            switch (edge) {
                case 0:
                    return { x: random(0, width), y: -margin };
                case 1:
                    return { x: random(0, width), y: height + margin };
                case 2:
                    return { x: -margin, y: random(0, height) };
                default:
                    return { x: width + margin, y: random(0, height) };
            }
        };

        /* ----------------------- Animation state ----------------------- */

        const position: Point = { x: -999, y: -999 };
        let heading = 0;
        let speed = 3;
        let turnRate = 0;
        let bankAngle = 0;

        let wanderTarget = 0;
        let wanderTimer = 0;

        let hasEntered = false; // has this flight appeared on screen yet?
        let pauseFrames = 0; // > 0 while waiting offscreen between flights
        let flightAge = 0;

        const trail: Point[] = [];

        let previousTime = 0;
        let animationId = 0;

        // Start a brand-new random flight from a random edge
        const startFlight = () => {
            const start = getEdgePoint();
            position.x = start.x;
            position.y = start.y;

            // Aim roughly at a random on-screen point (with extra jitter)
            const aim = { x: random(0, width), y: random(0, height) };
            heading =
                Math.atan2(aim.y - start.y, aim.x - start.x) + random(-0.5, 0.5);

            speed = random(SPEED_RANGE[0], SPEED_RANGE[1]);
            turnRate = 0;
            bankAngle = 0;
            wanderTarget = 0;
            wanderTimer = random(WANDER_DURATION[0], WANDER_DURATION[1]);
            hasEntered = false;
            flightAge = 0;
            trail.length = 0;
        };

        startFlight();

        const getTail = (): Point => ({
            x: position.x - Math.cos(heading) * TAIL_OFFSET,
            y: position.y - Math.sin(heading) * TAIL_OFFSET
        });

        /* ------------------------- Trail drawing ------------------------ */

        const drawFlightLines = () => {
            ctx.clearRect(0, 0, width, height);

            // Oldest -> newest, with a live head point glued to the tail
            // so the trail is always connected to the airplane.
            const pts = [...trail, getTail()];
            const n = pts.length;

            if (n < 2) return;

            // Smoothed normals shared by all three lines
            const nx = new Array<number>(n);
            const ny = new Array<number>(n);

            for (let i = 0; i < n; i++) {
                const prev = pts[Math.max(0, i - 2)];
                const next = pts[Math.min(n - 1, i + 2)];

                const dx = next.x - prev.x;
                const dy = next.y - prev.y;
                const len = Math.hypot(dx, dy) || 1;

                nx[i] = -dy / len;
                ny[i] = dx / len;
            }

            ctx.lineCap = "butt";
            ctx.lineJoin = "round";

            for (const line of TRAIL_LINES) {
                const xs = new Array<number>(n);
                const ys = new Array<number>(n);

                for (let i = 0; i < n; i++) {
                    xs[i] = pts[i].x + nx[i] * line.offset;
                    ys[i] = pts[i].y + ny[i] * line.offset;
                }

                // Two passes: soft wide glow, then crisp core
                for (let pass = 0; pass < 2; pass++) {
                    const isGlow = pass === 0;

                    for (let i = 1; i < n; i++) {
                        const t = i / (n - 1); // 0 = oldest, 1 = at the plane
                        const fade = Math.pow(t, 1.6);
                        const taper = 0.35 + 0.65 * t;

                        const alpha = fade * line.alpha * (isGlow ? 0.2 : 0.95);
                        if (alpha < 0.005) continue;

                        ctx.beginPath();
                        ctx.moveTo(xs[i - 1], ys[i - 1]);
                        ctx.lineTo(xs[i], ys[i]);
                        ctx.lineWidth = line.width * taper * (isGlow ? 3.8 : 1);
                        ctx.strokeStyle = `rgba(${line.color}, ${alpha})`;
                        ctx.stroke();
                    }
                }
            }
        };

        /* --------------------------- Main loop -------------------------- */

        const isInside = (p: Point, margin: number) =>
            p.x > -margin &&
            p.x < width + margin &&
            p.y > -margin &&
            p.y < height + margin;

        const animate = (time: number) => {
            if (!previousTime) previousTime = time;

            // Delta in 60fps frames, clamped so tab switches don't cause jumps
            const dt = Math.min((time - previousTime) / 16.667, 2.5);
            previousTime = time;

            // ---- Waiting offscreen between flights ----
            if (pauseFrames > 0) {
                pauseFrames -= dt;
                if (pauseFrames <= 0) startFlight();
                animationId = requestAnimationFrame(animate);
                return;
            }

            flightAge += dt;

            const onScreen = isInside(position, 0);
            if (onScreen) hasEntered = true;

            // Once the plane has been on the page and then leaves it, it is
            // free to fly away: no more steering, it just glides out.
            const leaving = hasEntered && !isInside(position, EXIT_MARGIN);

            // ---- Random wandering: new random steering every so often ----
            wanderTimer -= dt;
            if (wanderTimer <= 0) {
                wanderTarget =
                    Math.random() < 0.25
                        ? 0 // sometimes fly straight
                        : (Math.random() < 0.5 ? -1 : 1) *
                          MAX_TURN_RATE *
                          random(0.25, 1);

                wanderTimer = random(WANDER_DURATION[0], WANDER_DURATION[1]);
            }

            const targetRate = leaving ? 0 : wanderTarget;

            turnRate += (targetRate - turnRate) * smooth(0.04, dt);
            heading = normalizeAngle(heading + turnRate * dt);

            // ---- Move strictly along the heading ----
            position.x += Math.cos(heading) * speed * dt;
            position.y += Math.sin(heading) * speed * dt;

            // ---- Banking proportional to how hard we're turning ----
            const targetBank = (turnRate / MAX_TURN_RATE) * MAX_BANK;
            bankAngle += (targetBank - bankAngle) * smooth(0.07, dt);

            // ---- Apply airplane transform (single heading rotation) ----
            // Order: move -> face heading -> roll around the nose axis.
            const rotation = (heading * 180) / Math.PI + NOSE_OFFSET_DEG;

            plane.style.transform =
                `translate3d(${position.x - PLANE_SIZE / 2}px, ${position.y - PLANE_SIZE / 2}px, 0) ` +
                `rotate(${rotation}deg) ` +
                `perspective(300px) rotateY(${bankAngle}deg)`;

            // ---- Record trail point at the airplane's tail ----
            const tail = getTail();
            const last = trail[trail.length - 1];

            if (!last || Math.hypot(tail.x - last.x, tail.y - last.y) >= TRAIL_SPACING) {
                trail.push(tail);

                if (trail.length > MAX_TRAIL_POINTS) {
                    trail.shift();
                }
            }

            drawFlightLines();

            // ---- Flight over: plane AND trail are fully off the page ----
            const planeGone = !isInside(position, EXIT_MARGIN);
            const trailGone = trail.every((p) => !isInside(p, 10));

            if ((hasEntered && planeGone && trailGone) || flightAge > 3600) {
                ctx.clearRect(0, 0, width, height);
                position.x = -999;
                position.y = -999;
                plane.style.transform = `translate3d(-999px, -999px, 0)`;
                trail.length = 0;
                pauseFrames = random(PAUSE_RANGE[0], PAUSE_RANGE[1]) / 16.667;
            }

            animationId = requestAnimationFrame(animate);
        };

        animationId = requestAnimationFrame(animate);

        return () => {
            cancelAnimationFrame(animationId);
            window.removeEventListener("resize", resize);
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className="relative isolate w-full min-h-screen overflow-hidden bg-sky-50"
        >

            {/* Background Decorations */}
            <div className="absolute -top-36 -left-36 w-96 h-96 rounded-full border-2 border-dashed border-blue-300 opacity-60 pointer-events-none"></div>

            <div className="absolute -bottom-36 -right-36 w-80 h-80 rounded-full border-2 border-dashed border-blue-300 opacity-60 pointer-events-none"></div>

            <div className="absolute top-20 right-20 w-32 h-32 rounded-full bg-blue-100/50 blur-2xl pointer-events-none"></div>

            <div className="absolute bottom-20 left-20 w-40 h-40 rounded-full bg-sky-200/50 blur-3xl pointer-events-none"></div>


            {/* Three Blue Flight Lines */}
            <canvas
                ref={trailRef}
                className="absolute top-0 left-0 pointer-events-none -z-10"
            />


            {/* Airplane */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">

                <div
                    ref={planeRef}
                    className="absolute top-0 left-0 w-8 h-8 will-change-transform"
                    style={{ transformOrigin: "center center" }}
                >
                    <img
                        src={Airplane}
                        alt="Flying Airplane"
                        className="w-full h-full object-contain"
                    />
                </div>

            </div>


            {/* Main Content */}
            <div className="relative z-10 w-full min-h-screen flex flex-col justify-center items-center px-5 text-center">

                <div className="mb-5 px-5 py-2 rounded-full bg-blue-100 border border-blue-200">
                    <span className="text-blue-500 text-xs font-bold tracking-[3px]">
                        ✈ AIRPLANE ADVENTURE
                    </span>
                </div>

                <h1 className="text-6xl sm:text-7xl md:text-8xl font-black tracking-tight text-blue-400">
                    SKY <span className="text-blue-600">RUSH</span>
                </h1>

                <p className="mt-3 text-blue-500 font-semibold text-lg">
                    Take Flight. Dodge Danger. Rule the Skies.
                </p>

                <p className="mt-5 text-slate-500 max-w-xl text-sm sm:text-base leading-7">
                    Take control of your aircraft, soar through the endless skies,
                    dodge obstacles, and test your flying skills.
                    Are you ready to become the master of the skies?
                </p>

                <button 
                    onClick={handlePlay} 
                    className="mt-9 group flex items-center gap-3 bg-blue-500 hover:bg-blue-600 text-white font-bold px-12 py-4 rounded-full shadow-lg shadow-blue-300/50 hover:shadow-blue-400/60 hover:-translate-y-1 transition-all duration-300">
                    <span>PLAY NOW</span>
                    <span className="text-xl group-hover:translate-x-1 transition-transform">
                        ➜
                    </span>
                </button>

                <p className="absolute bottom-7 text-blue-300 text-xs tracking-widest">
                    READY FOR TAKEOFF?
                </p>

            </div>

        </div>
    );
}