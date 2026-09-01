import {
  AbsoluteFill,
  Composition,
  Img,
  Easing,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Official CCIG brand palette (color-palette/swatches/CCIG Brand Colors.pdf)
const BRAND = {
  green: "#8FB24E",
  lightBlue: "#366E8E",
  yellow: "#FFC666",
  darkBlue: "#153243",
  grey: "#BFC7CB",
  lightGrey: "#EDECED",
  white: "#FFFFFF",
};

const FPS = 30;
const DURATION_IN_SECONDS = 30;
const DURATION_IN_FRAMES = FPS * DURATION_IN_SECONDS;
const WIDTH = 1920;
const HEIGHT = 1080;

type BlobConfig = {
  color: string;
  size: number;
  top: number;
  left: number;
  cycles: number;
  phaseOffset: number;
  travelX: number;
  travelY: number;
  opacity: number;
};

// Each blob completes a whole number of orbits over the full duration, so
// frame 0 and frame DURATION_IN_FRAMES line up exactly for a seamless loop.
const BLOBS: BlobConfig[] = [
  {
    color: BRAND.lightBlue,
    size: 900,
    top: -220,
    left: -180,
    cycles: 1,
    phaseOffset: 0,
    travelX: 90,
    travelY: 60,
    opacity: 0.55,
  },
  {
    color: BRAND.green,
    size: 640,
    top: 480,
    left: 1400,
    cycles: 2,
    phaseOffset: Math.PI / 2,
    travelX: -70,
    travelY: 80,
    opacity: 0.4,
  },
  {
    color: BRAND.yellow,
    size: 520,
    top: 700,
    left: 200,
    cycles: 1,
    phaseOffset: Math.PI,
    travelX: 60,
    travelY: -50,
    opacity: 0.28,
  },
  {
    color: BRAND.lightBlue,
    size: 760,
    top: -160,
    left: 1200,
    cycles: 1,
    phaseOffset: Math.PI / 1.3,
    travelX: -80,
    travelY: 70,
    opacity: 0.35,
  },
];

const Blob: React.FC<{ config: BlobConfig; frame: number }> = ({
  config,
  frame,
}) => {
  const phase =
    (frame / DURATION_IN_FRAMES) * Math.PI * 2 * config.cycles +
    config.phaseOffset;
  const x = Math.cos(phase) * config.travelX;
  const y = Math.sin(phase) * config.travelY;

  return (
    <div
      style={{
        position: "absolute",
        top: config.top,
        left: config.left,
        width: config.size,
        height: config.size,
        borderRadius: "50%",
        background: config.color,
        opacity: config.opacity,
        filter: "blur(160px)",
        transform: `translate(${x}px, ${y}px)`,
      }}
    />
  );
};

const DotGrid: React.FC<{ frame: number }> = ({ frame }) => {
  const spacing = 56;
  const phase = (frame / DURATION_IN_FRAMES) * Math.PI * 2;
  const drift = Math.sin(phase) * spacing * 0.5;

  return (
    <div
      style={{
        position: "absolute",
        inset: -spacing,
        backgroundImage: `radial-gradient(${BRAND.white}22 2px, transparent 2px)`,
        backgroundSize: `${spacing}px ${spacing}px`,
        backgroundPosition: `${drift}px 0px`,
        opacity: 0.35,
      }}
    />
  );
};

const Vignette: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at center, transparent 35%, ${BRAND.darkBlue}CC 100%)`,
    }}
  />
);

export const NewsletterBackgroundComponent: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const bgFadeIn = interpolate(frame, [0, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Logo: reveal centered, settle into a corner watermark, gentle outro fade.
  const introEnd = 70;
  const parkStart = 95;
  const parkEnd = 160;
  const outroStart = durationInFrames - 45;

  const introProgress = interpolate(frame, [15, introEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const parkProgress = interpolate(frame, [parkStart, parkEnd], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.cubic),
  });

  const outroFade = interpolate(
    frame,
    [outroStart, durationInFrames],
    [1, 0.85],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const logoOpacity = interpolate(frame, [15, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  }) * outroFade;

  // Centered hero scale -> small corner-watermark scale.
  const centeredWidth = 620;
  const parkedWidth = 260;
  const logoWidth = interpolate(
    parkProgress,
    [0, 1],
    [centeredWidth, parkedWidth],
  );

  const centeredLeft = (WIDTH - centeredWidth) / 2;
  const centeredTop = HEIGHT / 2 - 90;
  const parkedLeft = WIDTH - parkedWidth - 96;
  const parkedTop = HEIGHT - 96 - parkedWidth * 0.277;

  const logoLeft = interpolate(parkProgress, [0, 1], [centeredLeft, parkedLeft]);
  const logoTop = interpolate(parkProgress, [0, 1], [centeredTop, parkedTop]);

  const introScale = interpolate(introProgress, [0, 1], [0.85, 1]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(135deg, ${BRAND.darkBlue} 0%, #0e2330 55%, ${BRAND.darkBlue} 100%)`,
        opacity: bgFadeIn,
      }}
    >
      <AbsoluteFill style={{ overflow: "hidden" }}>
        {BLOBS.map((blob, i) => (
          <Blob key={i} config={blob} frame={frame} />
        ))}
        <DotGrid frame={frame} />
      </AbsoluteFill>

      <Vignette />

      <div
        style={{
          position: "absolute",
          left: logoLeft,
          top: logoTop,
          width: logoWidth,
          opacity: logoOpacity,
          transform: `scale(${introScale})`,
          transformOrigin: "center",
        }}
      >
        <Img
          src={staticFile("branding/CCIG-White-Horizontal-RGB.png")}
          style={{ width: "100%", display: "block" }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const NewsletterBackground = () => {
  return (
    <Composition
      id="NewsletterBackground"
      component={NewsletterBackgroundComponent}
      durationInFrames={DURATION_IN_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
