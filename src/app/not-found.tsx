import ErrorExperience from "@/components/shared/ErrorExperience";

export default function NotFound() {
  return (
    <ErrorExperience
      code="404"
      title="This page drifted out of orbit"
      message="The page may have moved, the link may be outdated, or the address may be incorrect. We’ll guide you back home."
    />
  );
}
