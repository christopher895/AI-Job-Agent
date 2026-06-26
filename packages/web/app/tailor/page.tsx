import TailorForm from "../../components/TailorForm";

type Props = {
  searchParams: Promise<{ jobUrl?: string; title?: string; company?: string }>;
};

export default async function TailorPage({ searchParams }: Props) {
  const params = await searchParams;
  return (
    <TailorForm
      initialJobUrl={params.jobUrl ?? ""}
      initialTitle={params.title ?? ""}
      initialCompany={params.company ?? ""}
    />
  );
}
