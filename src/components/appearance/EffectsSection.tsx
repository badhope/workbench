import { useRef } from "react";
import { Trash2, Upload } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { isBackgroundDataUrl, useStore } from "../../lib/store";
import { useT } from "../../lib/i18n";
import { downscaleDimensions, fitsLocalStorage, pickOutputMime } from "../../lib/image";
import { Btn, Card, SectionTitle } from "../../ui";
import { MotionSelector } from "../MotionSelector";

export function EffectsSection() {
  const t = useT();
  const {
    motion,
    setMotion,
    particles,
    setParticles,
    particlesIntensity,
    setParticlesIntensity,
    backgroundImage,
    setBackground,
    setToast,
  } = useStore(
    useShallow((s) => ({
      motion: s.motion,
      setMotion: s.setMotion,
      particles: s.particles,
      setParticles: s.setParticles,
      particlesIntensity: s.particlesIntensity,
      setParticlesIntensity: s.setParticlesIntensity,
      backgroundImage: s.backgroundImage,
      setBackground: s.setBackground,
      setToast: s.setToast,
    }))
  );
  const bgFileRef = useRef<HTMLInputElement>(null);

  const importBackground = async (file: File | undefined) => {
    if (!file) return;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("decode failed"));
        img.src = dataUrl;
      });
      const { width, height } = downscaleDimensions(img.naturalWidth, img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(img, 0, 0, width, height);
      const out = canvas.toDataURL(pickOutputMime(file.type), 0.85);
      if (!fitsLocalStorage(out)) {
        setToast(t("settings.backgroundTooLarge"));
        return;
      }
      if (!isBackgroundDataUrl(out)) {
        setToast(t("settings.backgroundInvalid"));
        return;
      }
      setBackground(out);
    } catch {
      setToast(t("settings.backgroundInvalid"));
    } finally {
      if (bgFileRef.current) bgFileRef.current.value = "";
    }
  };

  return (
    <>
      <Card>
        <SectionTitle>{t("settings.motionSection")}</SectionTitle>
        <MotionSelector value={motion} onChange={setMotion} markLevel />
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          {t("settings.motionHint")}
        </p>
      </Card>

      <Card>
        <SectionTitle>{t("settings.particlesSection")}</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: true, key: "settings.particlesOn" },
              { id: false, key: "settings.particlesOff" },
            ] as const
          ).map((o) => (
            <button
              key={String(o.id)}
              type="button"
              data-particles={String(o.id)}
              aria-pressed={particles === o.id}
              onClick={() => setParticles(o.id)}
              className={`t-btn border px-2.5 py-1 text-[11.5px] font-medium ${
                particles === o.id
                  ? "border-accent bg-accent text-[var(--color-on-accent)]"
                  : "border-line bg-panel2/70 text-dim hover:text-text"
              }`}
            >
              {t(o.key)}
            </button>
          ))}
        </div>
        {particles && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[11px] text-dim">
              <label htmlFor="particles-intensity">
                {t("settings.particlesIntensity")}
              </label>
              <span className="num">{particlesIntensity}</span>
            </div>
            <input
              id="particles-intensity"
              type="range"
              min={0}
              max={100}
              step={5}
              value={particlesIntensity}
              onChange={(e) => setParticlesIntensity(Number(e.target.value))}
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          {t("settings.particlesHint")}
        </p>
      </Card>

      <Card>
        <SectionTitle>{t("settings.backgroundSection")}</SectionTitle>
        <input
          ref={bgFileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => void importBackground(e.target.files?.[0])}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => bgFileRef.current?.click()}>
            <Upload size={14} /> {t("settings.backgroundChoose")}
          </Btn>
          {backgroundImage && (
            <>
              {/* 缩略图：确认当前是哪张图，避免"存了但忘了" */}
              <img
                src={backgroundImage}
                alt=""
                className="h-14 w-24 rounded-[var(--radius-btn)] border border-line object-cover"
              />
              <Btn
                onClick={() => {
                  setBackground(null);
                  if (bgFileRef.current) bgFileRef.current.value = "";
                }}
                className="!py-1 !text-xs"
              >
                <Trash2 size={12} /> {t("settings.backgroundClear")}
              </Btn>
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-dim">
          {t("settings.backgroundHint")}
        </p>
      </Card>
    </>
  );
}
