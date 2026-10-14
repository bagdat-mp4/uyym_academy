// Hide the legacy affiliation FAQ without modifying owner-entered database data.
export function publicFaq(items:{question:string;answer:string}[]) {
 return items.filter(item=>{
  const text=item.question+' '+item.answer;
  const school=/(?:КБТУ|KBTU)/i.test(text);
  const affiliation=/(?:серіктест|партн[её]р|partnership)/i.test(text)||/UYYM\s+Academy/i.test(text)&&/(?:ресми|официал|official)/i.test(text);
  return !(school&&affiliation);
 });
}
