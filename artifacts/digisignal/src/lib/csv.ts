export function parseCSV(text: string): Record<string, string>[] {
  const result: string[][] = [];
  let currentLine: string[] = [];
  let currentCell = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i++; // skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentCell);
      currentCell = '';
    } else if (char === '\n' && !inQuotes) {
      currentLine.push(currentCell);
      result.push(currentLine);
      currentLine = [];
      currentCell = '';
    } else if (char === '\r' && !inQuotes && nextChar === '\n') {
      // Skip \r, let \n handle it
    } else if (char === '\r' && !inQuotes) {
      currentLine.push(currentCell);
      result.push(currentLine);
      currentLine = [];
      currentCell = '';
    } else {
      currentCell += char;
    }
  }
  
  if (currentCell !== '' || currentLine.length > 0) {
    currentLine.push(currentCell);
    result.push(currentLine);
  }
  
  const filtered = result.filter(line => line.length > 1 || (line.length === 1 && line[0].trim() !== ''));
  if (filtered.length === 0) return [];
  
  const headers = filtered[0].map(h => h.toLowerCase().trim().replace(/[^a-z0-9_]/g, '_'));
  
  const rows = [];
  for (let i = 1; i < filtered.length; i++) {
    const values = filtered[i];
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = values[index]?.trim() ?? '';
    });
    rows.push(obj);
  }
  return rows;
}
