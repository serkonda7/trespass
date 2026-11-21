// The app's icon set: Tabler outline icons (@tabler/icons-solidjs), imported
// here only, as plain named imports (the tablerIcons() Vite plugin rewrites
// them to per-icon modules). Every icon is decorative by default (aria-hidden)
// and drawn with one stroke width, so call sites stay `<IconMap class="size-4" />`.
// Give an icon an accessible name through its button/link text, not the SVG.
import {
  IconAdjustmentsHorizontal as TAdjustmentsHorizontal,
  IconAlertTriangle as TAlertTriangle,
  IconArrowDown as TArrowDown,
  IconArrowsMove as TArrowsMove,
  IconArrowUp as TArrowUp,
  IconBackpack as TBackpack,
  IconBed as TBed,
  IconBook as TBook,
  IconBuildingChurch as TBuildingChurch,
  IconBuildingFactory2 as TBuildingFactory2,
  IconBuildingHospital as TBuildingHospital,
  IconCar as TCar,
  IconCheck as TCheck,
  IconChevronDown as TChevronDown,
  IconChevronRight as TChevronRight,
  IconCircle as TCircle,
  IconCopy as TCopy,
  IconExternalLink as TExternalLink,
  IconHome as THome,
  IconKey as TKey,
  IconList as TList,
  IconLogout as TLogout,
  IconMap as TMap,
  IconMessage as TMessage,
  IconPencil as TPencil,
  IconPhoneCall as TPhoneCall,
  IconPhoto as TPhoto,
  IconPlus as TPlus,
  IconRoute as TRoute,
  IconSearch as TSearch,
  IconSearchOff as TSearchOff,
  IconSettings as TSettings,
  IconShare as TShare,
  IconShield as TShield,
  IconTelescope as TTelescope,
  IconTicket as TTicket,
  IconTrain as TTrain,
  IconTrash as TTrash,
  IconUser as TUser,
  IconUsers as TUsers,
  IconWheat as TWheat,
  IconX as TX,
} from "@tabler/icons-solidjs";
import type { JSX } from "solid-js";

// Derived from a component, not `import type { IconProps }`: the tablerIcons()
// Vite plugin drops type-only imports of the package, so a re-export of one
// would point at nothing.
export type IconProps = Parameters<typeof TX>[0];
export type IconComponent = (props: IconProps) => JSX.Element;

const STROKE = 1.75;
const wrap =
  (Icon: IconComponent): IconComponent =>
  (props) => <Icon aria-hidden="true" strokeWidth={STROKE} {...props} />;

export const IconAdjustmentsHorizontal = wrap(TAdjustmentsHorizontal);
export const IconAlertTriangle = wrap(TAlertTriangle);
export const IconArrowDown = wrap(TArrowDown);
export const IconArrowsMove = wrap(TArrowsMove);
export const IconArrowUp = wrap(TArrowUp);
export const IconBackpack = wrap(TBackpack);
export const IconBed = wrap(TBed);
export const IconBook = wrap(TBook);
export const IconBuildingChurch = wrap(TBuildingChurch);
export const IconBuildingFactory2 = wrap(TBuildingFactory2);
export const IconBuildingHospital = wrap(TBuildingHospital);
export const IconCar = wrap(TCar);
export const IconCheck = wrap(TCheck);
export const IconChevronDown = wrap(TChevronDown);
export const IconChevronRight = wrap(TChevronRight);
export const IconCircle = wrap(TCircle);
export const IconCopy = wrap(TCopy);
export const IconExternalLink = wrap(TExternalLink);
export const IconHome = wrap(THome);
export const IconKey = wrap(TKey);
export const IconList = wrap(TList);
export const IconLogout = wrap(TLogout);
export const IconMap = wrap(TMap);
export const IconMessage = wrap(TMessage);
export const IconPencil = wrap(TPencil);
export const IconPhoneCall = wrap(TPhoneCall);
export const IconPhoto = wrap(TPhoto);
export const IconPlus = wrap(TPlus);
export const IconRoute = wrap(TRoute);
export const IconSearch = wrap(TSearch);
export const IconSearchOff = wrap(TSearchOff);
export const IconSettings = wrap(TSettings);
export const IconShare = wrap(TShare);
export const IconShield = wrap(TShield);
export const IconTelescope = wrap(TTelescope);
export const IconTicket = wrap(TTicket);
export const IconTrain = wrap(TTrain);
export const IconTrash = wrap(TTrash);
export const IconUser = wrap(TUser);
export const IconUsers = wrap(TUsers);
export const IconWheat = wrap(TWheat);
export const IconX = wrap(TX);
