const sec2RelativeTime = (sec: number): string => {
  const di = Math.floor(sec / 86400) || '';
  const hr = Math.floor((sec % 86400) / 3600) || '';
  const min = Math.floor((sec % 3600) / 60) || '';
  const se = Math.floor(sec % 60) || '';
  return '' + (di && `${di}d`) + (hr && ` ${hr}hr`) + (min && ` ${min}min`) + (se && ` ${se}seg`);
};

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const strIncludes = (str: string, list: string[]): string[] | [] => list.filter(item => str.match(new RegExp(`\\b${item}\\b`, 'i')));

export { sec2RelativeTime, wait, strIncludes };
