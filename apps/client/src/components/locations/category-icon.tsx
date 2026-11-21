// Category icons (DESIGN §2). The seeded categories store an icon key
// ("factory", "hospital", …); this maps each key to a Tabler icon. Unknown
// keys (admin edits) fall back to a plain circle.
import { splitProps } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  IconBed,
  IconBuildingChurch,
  IconBuildingFactory2,
  IconBuildingHospital,
  IconCircle,
  type IconComponent,
  IconHome,
  type IconProps,
  IconShield,
  IconTicket,
  IconTrain,
  IconWheat,
} from "~/components/ui/icons";

export const CATEGORY_ICONS: Record<string, IconComponent> = {
  factory: IconBuildingFactory2,
  hospital: IconBuildingHospital,
  shield: IconShield,
  home: IconHome,
  house: IconHome,
  hotel: IconBed,
  train: IconTrain,
  church: IconBuildingChurch,
  ticket: IconTicket,
  wheat: IconWheat,
  circle: IconCircle,
};

export const categoryIconComponent = (name: string | null | undefined): IconComponent =>
  (name && CATEGORY_ICONS[name]) || IconCircle;

export function CategoryIcon(props: { name: string | null | undefined } & IconProps) {
  const [local, others] = splitProps(props, ["name"]);
  return <Dynamic component={categoryIconComponent(local.name)} {...others} />;
}
