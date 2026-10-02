import { createContext, useContext, useMemo, type ReactNode } from 'react';
export type ImportedFile = {
  id: string;
  source_url: string;
  status: 'ready' | 'source_unavailable';
  source_status: number | null;
};
const Files = createContext<ImportedFile[]>([]);
export function ImportedFilesProvider({
  files,
  children,
}: {
  files: ImportedFile[];
  children: ReactNode;
}) {
  return <Files.Provider value={files}>{children}</Files.Provider>;
}
export function useImportedFiles() {
  return useContext(Files);
}
export function fileHref(file: ImportedFile) {
  return /^[a-f0-9-]{36}$/.test(file.id)
    ? '/api/v1/imported-files/' + file.id + '/content'
    : undefined;
}
export function ImportedFileLinks({ text }: { text: string }) {
  const files = useImportedFiles();
  const references = useMemo(() => {
    const urls = new Set(text.match(/https:\/\/uploads\.linear\.app\/[^\s)<>"\]]+/g) ?? []);
    const latest = new Map<string, ImportedFile>();
    for (const file of files) if (urls.has(file.source_url)) latest.set(file.source_url, file);
    return [...latest.values()];
  }, [files, text]);
  if (!references.length) return null;
  return (
    <section className="imported-file-links" aria-label="Imported source files">
      <p className="section-hint">
        Source files are retained privately. Original Markdown links remain unchanged.
      </p>
      {references.map((file, index) => (
        <div key={file.id}>
          {file.status === 'ready' ? (
            <a href={fileHref(file)} target="_blank" rel="noopener noreferrer">
              Download source file {index + 1}
            </a>
          ) : (
            <span>
              Source file {index + 1} was unavailable from Linear ({file.source_status}).{' '}
              <a href={file.source_url} target="_blank" rel="noopener noreferrer">
                Original reference
              </a>
            </span>
          )}
        </div>
      ))}
    </section>
  );
}

export function ImportedSourceLink({
  url,
  children,
  className,
}: {
  url: string;
  children: ReactNode;
  className?: string;
}) {
  const files = useImportedFiles();
  const file = useMemo(
    () => [...files].reverse().find((item) => item.source_url === url),
    [files, url],
  );
  if (file?.status === 'source_unavailable')
    return (
      <span className={className}>
        {children}
        <small>
          Source unavailable ({file.source_status}).{' '}
          <a href={url} target="_blank" rel="noopener noreferrer">
            Original reference
          </a>
        </small>
      </span>
    );
  return (
    <a
      className={className}
      href={file ? fileHref(file) : url}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}
