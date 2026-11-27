"use client";

import { useMemo, useState } from "react";
import { AyniStressCommittee } from "@/components/AyniStressCommittee";
import { ChasquiIntake } from "@/components/ChasquiIntake";
import { KipuScheduleView } from "@/components/KipuScheduleView";
import { type ActiveModuleId, TopNavKpiBar } from "@/components/TopNavKpiBar";
import { PERUVIAN_ARCHETYPES } from "@/lib/archetypes";
import { buildComparisonSchedules, simulateAllStressScenarios } from "@/lib/financial-engine";
import type { BusinessArchetype, BusinessProfile, CreditParams } from "@/lib/types";

export default function HomePage() {
  const initialArchetype = PERUVIAN_ARCHETYPES[0];

  const [activeModule, setActiveModule] = useState<ActiveModuleId>("chasqui");
  const [selectedArchetypeId, setSelectedArchetypeId] = useState<string>(initialArchetype.id);
  const [profile, setProfile] = useState<BusinessProfile>(initialArchetype.profile);
  const [params, setParams] = useState<CreditParams>({
    ...initialArchetype.recommendedCredit,
    disbursementDate: "2026-01-15",
  });

  const handleSelectArchetype = (arch: BusinessArchetype) => {
    setSelectedArchetypeId(arch.id);
    setProfile(arch.profile);
    setParams((prev) => ({
      ...arch.recommendedCredit,
      disbursementDate: prev.disbursementDate,
    }));
  };

  const { kipu, fixed } = useMemo(
    () => buildComparisonSchedules(profile, params),
    [profile, params]
  );

  const stressResults = useMemo(
    () => simulateAllStressScenarios(profile, params),
    [profile, params]
  );

  return (
    <div className="min-h-screen bg-slate-50 pb-14">
      <TopNavKpiBar
        activeModule={activeModule}
        onSelectModule={setActiveModule}
        businessName={profile.name}
        params={params}
        kipuSchedule={kipu}
        fixedSchedule={fixed}
      />

      <main className="mx-auto max-w-7xl px-4 pt-4 lg:px-6">
        <div className={activeModule === "chasqui" ? "" : "hidden"} aria-hidden={activeModule !== "chasqui"}>
          <ChasquiIntake
            selectedArchetypeId={selectedArchetypeId}
            onSelectArchetype={handleSelectArchetype}
            profile={profile}
            onChangeProfile={setProfile}
            params={params}
            onChangeParams={setParams}
            onNextModule={() => setActiveModule("kipu")}
          />
        </div>

        {activeModule === "kipu" && (
          <KipuScheduleView
            businessName={profile.name}
            params={params}
            onChangeParams={setParams}
            kipuSchedule={kipu}
            fixedSchedule={fixed}
            onNextModule={() => setActiveModule("ayni")}
          />
        )}

        <div className={activeModule === "ayni" ? "" : "hidden"} aria-hidden={activeModule !== "ayni"}>
          <AyniStressCommittee
            profile={profile}
            params={params}
            stressResults={stressResults}
          />
        </div>
      </main>

      <footer className="mx-auto mt-10 max-w-7xl border-t border-slate-200 px-4 pt-5 text-center text-xs text-slate-500 lg:px-6 no-print">
        KipuAI · Prototipo Funcional CAJATHON 2026 (Desafío NEG-01: Caja Trujillo) · Motor Exacto
        Base 360, Prelación Pendientes→Periodo (Seguros→Interés→Capital) y Zona Horaria America/Lima · 100% Autónomo
      </footer>
    </div>
  );
}
