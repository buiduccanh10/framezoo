import { FooterView } from "@/components/layout/Footer";
import { Navigation } from "@/components/layout/Navigation";

export function HomeLayout(props: {
  showBg: boolean;
  children: React.ReactNode;
}) {
  return (
    <FooterView>
      <Navigation
        bg={props.showBg}
        clearBackground={false}
        noLightbar={false}
      />
      {props.children}
    </FooterView>
  );
}
