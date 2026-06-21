import Link from "next/link";
import AppBootState from "@/components/shared/AppBootState";

export default function NotFound() {
  return (
    <div className="relative">
      <AppBootState
        mode="error"
        title="Unable to load AdsGalaxy"
        message="We couldn't find that page. Please reload and try again."
        detail="If this continues, contact support."
      />
      <Link href="/" className="sr-only">Return home</Link>
    </div>
  );
}
