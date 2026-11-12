/** An organization an event can use as its map pin (#1212): its id and the label the picker shows. */
export type MapSiteOption = { id: string; label: string };

/** "Name (Town, ST)", leaving out whatever town or state is not known. */
export function mapSiteLabel(name: string, city: string, state: string) {
  const place = [city.trim(), state.trim()].filter(Boolean).join(", ");
  return place ? `${name} (${place})` : name;
}
