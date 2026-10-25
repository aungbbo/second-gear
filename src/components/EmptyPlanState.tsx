import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function EmptyPlanState({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <span className="mx-auto w-14 h-14 rounded-full bg-teal-paper flex items-center justify-center">
        <Compass className="w-6 h-6 text-teal" />
      </span>
      <h1 className="font-display font-bold text-xl mt-4">{title}</h1>
      <p className="mt-2 text-sm text-ink-soft">Run a search in Find My Car first — this tab fills in with your results.</p>
      <Link href="/find-my-car">
        <Button size="lg" className="mt-6">
          Go to Find My Car
        </Button>
      </Link>
    </div>
  );
}
