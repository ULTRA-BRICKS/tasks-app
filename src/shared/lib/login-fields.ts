/** Read the browser's actual fields, including silent autofill; never serialize them to storage. */
export function formText(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === 'string' ? value : '';
}
export function readLoginFields(data: FormData): { email: string; password: string } {
  return { email: formText(data, 'email').trim(), password: formText(data, 'password') };
}
export function isComposingEnter(event: {
  key: string;
  isComposing: boolean;
  keyCode?: number;
}): boolean {
  return event.key === 'Enter' && (event.isComposing || event.keyCode === 229);
}
