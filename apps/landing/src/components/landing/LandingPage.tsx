import { InstallProvider } from "#/components/landing/InstallContext";
import { HeroSection } from "#/components/landing/HeroSection";
import { FeaturesSection } from "#/components/landing/FeaturesSection";
import { QuestTypesSection } from "#/components/landing/QuestTypesSection";
import { CtaSection } from "#/components/landing/CtaSection";

export function LandingPage() {
  return (
    <InstallProvider>
      <HeroSection />
      <FeaturesSection />
      <QuestTypesSection />
      <CtaSection />
    </InstallProvider>
  );
}
