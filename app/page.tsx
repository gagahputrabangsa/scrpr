import { isServerAuthenticated } from "@/lib/auth";
import { SmartScraperClient } from "@/components/smart-scraper-client";

export const dynamic = "force-dynamic";

export default function SmartScraperPage() {
  const authenticated = isServerAuthenticated();
  return <SmartScraperClient initialAuthenticated={authenticated} />;
}
