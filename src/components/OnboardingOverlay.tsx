import { useState } from "react";
import { useStore } from "../lib/store";
import { useT } from "../lib/i18n";
import { BUILTIN_THEMES, swatchOf } from "../lib/theme/presets";
import type { MotionLevel } from "../lib/theme/apply";
import { Btn, Modal } from "../ui";
import { WorkModeChoices } from "./WorkModeChoices";

/** 引导第 3 步可选的动效档位。与外观面板同一份语义，各自维护展示文案。 */
const MOTIONS: { id: MotionLevel; key: string }[] = [
  { id: "off", key: "settings.motionOff" },
  { id: "standard", key: "settings.motionStandard" },
  { id: "rich", key: "settings.motionRich" },
];

/**
 * 首启 3 步引导（视觉 2.0，P0-7）。
 *
 * 流程：功能一览 → 主题选择（色卡可即时切换）→ 动效档位。
 * 「完成」与「跳过」同义：都置 onboardingDone 并持久化，永不复弹。
 * 复用 Modal 的焦点圈定/ESC 语义：ESC 关闭 = 跳过并记忆，
 * 用户不可能被一个引导浮层困住。
 *
 * 动效尊重 data-motion：off 档下容器退化为纯 opacity 淡入
 * （.motion-safe-fade 不在断闸名单里），没有位移动画。
 */
export function OnboardingOverlay() {
  const t = useT();
  const onboardingDone = useStore((s) => s.onboardingDone);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const motion = useStore((s) => s.motion);
  const setMotion = useStore((s) => s.setMotion);
  const workModes = useStore((s) => s.workModes);
  const setWorkModes = useStore((s) => s.setWorkModes);
  const setOnboardingDone = useStore((s) => s.setOnboardingDone);
  const [step, setStep] = useState(0);
  const total = 4;

  if (onboardingDone) return null;

  const finish = () => setOnboardingDone();
  const motionOff = document.documentElement.dataset.motion === "off";
  const enterCls = motionOff ? "motion-safe-fade" : "animate-in";

  return (
    <Modal open title={t("onboarding.title")} onClose={finish}>
      <div className={enterCls} data-onboarding-step={step}>
        <div className="mb-1 text-[10.5px] font-medium tracking-[0.06em] text-faint">
          {t("onboarding.stepLabel", { n: step + 1, total })}
        </div>

        {step === 0 && (
          <div>
            <h3 className="text-[15px] font-semibold">{t("workMode.title")}</h3>
            <p className="mt-1 text-[12px] text-dim">{t("workMode.body")}</p>
            <div className="mt-3">
              <WorkModeChoices value={workModes} onChange={setWorkModes} />
            </div>
            <p className={`mt-2 text-[11px] ${workModes.length ? "text-faint" : "text-warn"}`}>
              {workModes.length
                ? t("workMode.selected", { count: workModes.length })
                : t("workMode.required")}
            </p>
          </div>
        )}

        {step === 1 && (
          <div>
            <h3 className="text-[15px] font-semibold">{t("onboarding.step1Title")}</h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-dim">
              <li>{t("onboarding.step1Point1")}</li>
              <li>{t("onboarding.step1Point2")}</li>
              <li>{t("onboarding.step1Point3")}</li>
            </ul>
          </div>
        )}

        {step === 2 && (
          <div>
            <h3 className="text-[15px] font-semibold">{t("onboarding.step2Title")}</h3>
            <p className="mt-1 text-[12px] text-dim">{t("onboarding.step2Body")}</p>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              {BUILTIN_THEMES.map((th) => {
                const [bg, panel, accent] = swatchOf(th);
                const active = theme === th.id;
                return (
                  <button
                    key={th.id}
                    type="button"
                    aria-label={th.name}
                    aria-pressed={active}
                    onClick={() => setTheme(th.id)}
                    className={`overflow-hidden rounded-[var(--radius-btn)] border text-left transition-colors ${
                      active ? "border-accent" : "border-line hover:border-accent/40"
                    }`}
                    style={{ background: panel }}
                  >
                    <div className="flex h-7 gap-0.5 p-1" style={{ background: bg }}>
                      <span
                        className="h-full w-1/3"
                        style={{ background: accent, borderRadius: 2 }}
                      />
                      <span
                        className="h-full flex-1"
                        style={{ background: panel, borderRadius: 2 }}
                      />
                    </div>
                    <div
                      className="truncate px-1 py-0.5 text-[9.5px]"
                      style={{ color: th.text }}
                    >
                      {th.name}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-faint">{t("onboarding.step2Hint")}</p>
          </div>
        )}

        {step === 3 && (
          <div>
            <h3 className="text-[15px] font-semibold">{t("onboarding.step3Title")}</h3>
            <p className="mt-1 text-[12px] text-dim">{t("onboarding.step3Body")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {MOTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={motion === m.id}
                  onClick={() => setMotion(m.id)}
                  className={`t-btn border px-2.5 py-1 text-[11.5px] font-medium ${
                    motion === m.id
                      ? "border-accent bg-accent text-[var(--color-on-accent)]"
                      : "border-line bg-panel2/70 text-dim hover:text-text"
                  }`}
                >
                  {t(m.key)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <Btn onClick={finish}>{t("onboarding.skip")}</Btn>
        <div className="flex gap-2">
          {step > 0 && (
            <Btn onClick={() => setStep(step - 1)}>{t("onboarding.back")}</Btn>
          )}
          {step < total - 1 ? (
            <Btn
              variant="primary"
              disabled={step === 0 && workModes.length === 0}
              onClick={() => setStep(step + 1)}
            >
              {t("onboarding.next")}
            </Btn>
          ) : (
            <Btn variant="primary" onClick={finish}>
              {t("onboarding.done")}
            </Btn>
          )}
        </div>
      </div>
    </Modal>
  );
}
