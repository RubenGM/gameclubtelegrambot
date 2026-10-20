const clubTimeZone = 'Europe/Madrid';

export function groupPurchaseDateParts(value: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: clubTimeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((part) => part.type === type)!.value;
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Convert the end of an already validated club-local date to a UTC instant. */
export function endOfGroupPurchaseDay(date: string): string {
  const desired = Date.parse(`${date}T23:59:59.000Z`);
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { year, month, day, hour, minute, second } = groupPurchaseDateParts(new Date(candidate).toISOString());
    const represented = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`);
    candidate += desired - represented;
  }
  return new Date(candidate).toISOString();
}
