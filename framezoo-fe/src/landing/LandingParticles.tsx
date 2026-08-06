import { useEffect, useRef } from "react";

interface ParticleSprite {
  src: string;
  sizeRange: [number, number];
}

const PARTICLE_SPRITES: ParticleSprite[] = [
  { src: "/lightbar-images/camera.png", sizeRange: [22, 32] },
  { src: "/lightbar-images/cat.png", sizeRange: [26, 36] },
  { src: "/lightbar-images/ghost.png", sizeRange: [22, 32] },
  { src: "/lightbar-images/popcorn.png", sizeRange: [18, 28] },
  { src: "/lightbar-images/snowflake.svg", sizeRange: [14, 24] },
  { src: "/lightbar-images/star.png", sizeRange: [16, 26] },
];

const MAX_DEVICE_PIXEL_RATIO = 2;
const DESKTOP_PARTICLE_COUNT = 190;
const MOBILE_PARTICLE_COUNT = 82;

function getParticleCount(width: number) {
  return width <= 640 ? MOBILE_PARTICLE_COUNT : DESKTOP_PARTICLE_COUNT;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

class LandingParticle {
  x = 0;

  y = 0;

  size = 1;

  angle = 0;

  speed = 0;

  age = 0;

  lifetime = 1;

  rotation = 0;

  rotationSpeed = 0;

  sprite: ParticleSprite | null;

  image: HTMLImageElement | null;

  constructor(
    private width: number,
    private height: number,
    sprite: ParticleSprite | null,
    image: HTMLImageElement | null,
  ) {
    this.sprite = sprite;
    this.image = image;
    this.reset(true);
  }

  reset(initial = false) {
    this.size = this.sprite
      ? randomBetween(this.sprite.sizeRange[0], this.sprite.sizeRange[1])
      : randomBetween(1, 2.6);
    this.x = randomBetween(-this.width * 0.08, this.width * 1.08);
    this.y = initial
      ? randomBetween(-this.height * 0.1, this.height)
      : -this.size - randomBetween(0, this.height * 0.12);
    this.angle = randomBetween(Math.PI * 0.23, Math.PI * 0.77);
    this.speed = randomBetween(8, 28);
    this.lifetime = randomBetween(8, 24);
    this.age = initial ? randomBetween(0, this.lifetime) : 0;
    this.rotation = randomBetween(-Math.PI, Math.PI);
    this.rotationSpeed = randomBetween(-0.25, 0.25);
  }

  resize(width: number, height: number) {
    this.x = (this.x / this.width) * width;
    this.y = (this.y / this.height) * height;
    this.width = width;
    this.height = height;

    if (this.x < -width * 0.1 || this.x > width * 1.1) {
      this.x = randomBetween(0, width);
    }
    if (this.y > height) {
      this.y = randomBetween(-height * 0.1, height);
    }
  }

  update(deltaMs: number) {
    const deltaSeconds = deltaMs / 1000;
    this.age += deltaSeconds;
    this.x += Math.cos(this.angle) * this.speed * deltaSeconds;
    this.y += Math.sin(this.angle) * this.speed * deltaSeconds;
    this.rotation += this.rotationSpeed * deltaSeconds;

    if (
      this.age >= this.lifetime ||
      this.y > this.height + this.size ||
      this.x < -this.size * 2 ||
      this.x > this.width + this.size * 2
    ) {
      this.reset();
    }
  }

  draw(context: CanvasRenderingContext2D) {
    const progress = Math.min(this.age / this.lifetime, 1);
    const lifeOpacity = Math.sin(progress * Math.PI);
    const opacity = lifeOpacity * (this.sprite ? 0.42 : 0.65);

    if (opacity <= 0) return;

    context.save();
    context.globalAlpha = opacity;

    if (this.sprite && this.image?.complete && this.image.naturalWidth > 0) {
      const aspectRatio = this.image.naturalHeight / this.image.naturalWidth;
      const height = this.size * aspectRatio;

      context.translate(this.x, this.y);
      context.rotate(this.rotation);
      context.drawImage(
        this.image,
        -this.size / 2,
        -height / 2,
        this.size,
        height,
      );
    } else {
      context.translate(this.x, this.y);
      context.rotate(this.angle);
      context.fillStyle = "rgba(240, 252, 252, 0.9)";
      context.beginPath();
      context.ellipse(0, 0, this.size, this.size * 1.8, 0, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }
}

export function LandingParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const layer = canvas?.parentElement;
    const context = canvas?.getContext("2d");

    if (!canvas || !layer || !context) return;

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const images = new Map<string, HTMLImageElement>();
    const particles: LandingParticle[] = [];
    let width = 0;
    let height = 0;
    let frame: number | null = null;
    let isRunning = !mediaQuery.matches;
    let lastTimestamp = performance.now();

    for (const sprite of PARTICLE_SPRITES) {
      const image = new Image();
      image.decoding = "async";
      image.src = sprite.src;
      images.set(sprite.src, image);
    }

    const draw = () => {
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        particle.draw(context);
      }
    };

    const resize = () => {
      const bounds = layer.getBoundingClientRect();
      const nextWidth = Math.max(1, bounds.width);
      const nextHeight = Math.max(1, bounds.height);
      const devicePixelRatio = Math.min(
        window.devicePixelRatio || 1,
        MAX_DEVICE_PIXEL_RATIO,
      );

      canvas.width = Math.round(nextWidth * devicePixelRatio);
      canvas.height = Math.round(nextHeight * devicePixelRatio);
      canvas.style.width = `${nextWidth}px`;
      canvas.style.height = `${nextHeight}px`;
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      if (particles.length === 0) {
        const particleCount = getParticleCount(nextWidth);
        const imageCount = Math.round(particleCount * 0.14);

        for (let index = 0; index < particleCount; index += 1) {
          const sprite =
            index < imageCount
              ? PARTICLE_SPRITES[
                  Math.floor(Math.random() * PARTICLE_SPRITES.length)
                ]
              : null;
          particles.push(
            new LandingParticle(
              nextWidth,
              nextHeight,
              sprite,
              sprite ? (images.get(sprite.src) ?? null) : null,
            ),
          );
        }
      } else {
        for (const particle of particles) {
          particle.resize(nextWidth, nextHeight);
        }
      }

      width = nextWidth;
      height = nextHeight;
      draw();
    };

    const tick = (timestamp: number) => {
      if (!isRunning) return;

      const deltaMs = Math.min(timestamp - lastTimestamp, 48);
      lastTimestamp = timestamp;
      for (const particle of particles) {
        particle.update(deltaMs);
      }
      draw();
      frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (isRunning) return;
      isRunning = true;
      lastTimestamp = performance.now();
      frame = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      isRunning = false;
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
      draw();
    };

    const handleMotionPreferenceChange = () => {
      if (mediaQuery.matches) {
        stop();
      } else {
        start();
      }
    };

    resize();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    resizeObserver?.observe(layer);
    const handleWindowResize = () => resize();
    if (!resizeObserver) {
      window.addEventListener("resize", handleWindowResize);
    }
    mediaQuery.addEventListener("change", handleMotionPreferenceChange);

    if (isRunning) {
      frame = window.requestAnimationFrame(tick);
    }

    return () => {
      resizeObserver?.disconnect();
      if (!resizeObserver) {
        window.removeEventListener("resize", handleWindowResize);
      }
      mediaQuery.removeEventListener("change", handleMotionPreferenceChange);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  return (
    <div className="landing-particles-layer" aria-hidden="true">
      <canvas ref={canvasRef} className="landing-particle-canvas" />
    </div>
  );
}
