import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface LegalDocumentPageProps {
  title: string;
  subtitle: string;
  sourcePath: string;
}

export const LegalDocumentPage = ({
  title,
  subtitle,
  sourcePath,
}: LegalDocumentPageProps) => {
  const [content, setContent] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let active = true;

    const loadDocument = async () => {
      setIsLoading(true);
      setHasError(false);

      try {
        const response = await fetch(sourcePath);
        if (!response.ok) {
          throw new Error(`Failed to load ${sourcePath}`);
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const bodyHtml = doc.body?.innerHTML?.trim() || html;

        if (active) {
          setContent(bodyHtml);
        }
      } catch {
        if (active) {
          setHasError(true);
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void loadDocument();

    return () => {
      active = false;
    };
  }, [sourcePath]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-zinc-50 via-white to-zinc-100">
      <div className="mx-auto w-full max-w-5xl px-4 py-10 md:px-8 md:py-14">
        <div className="mb-8 rounded-3xl border border-zinc-200 bg-white/95 p-6 shadow-sm md:p-8">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-500">
            WUW Rentals
          </p>
          <h1 className="mt-2 text-3xl font-black text-zinc-900 md:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-sm text-zinc-600 md:text-base">{subtitle}</p>

          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              to="/"
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-900 hover:text-zinc-900"
            >
              Back to Home
            </Link>
            <a
              href={sourcePath}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-black"
            >
              Open Original File
            </a>
          </div>
        </div>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
          {isLoading && (
            <p className="text-zinc-600">Loading document...</p>
          )}

          {hasError && (
            <p className="text-red-600">
              This document could not be loaded. Please use "Open Original File".
            </p>
          )}

          {!isLoading && !hasError && (
            <article
              className="legal-content text-sm leading-7 text-zinc-700 md:text-base [&_h1]:mb-6 [&_h1]:text-2xl [&_h1]:font-black [&_h1]:text-zinc-900 [&_p]:mb-4 [&_b]:text-zinc-900 [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap [&_pre]:rounded-2xl [&_pre]:bg-zinc-50 [&_pre]:p-4 [&_pre]:text-sm"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          )}
        </section>
      </div>
    </main>
  );
};
