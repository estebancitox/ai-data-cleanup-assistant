// The one place that hands a file to the browser's download.

export function saveFile(name: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Released after the click has been handled; some browsers cancel the download otherwise.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
