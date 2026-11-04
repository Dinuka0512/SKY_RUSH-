import type { Route } from "./+types/home";
import { Welcome } from "../welcome/welcome";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "SKY RUSH | Airplane Adventure Game" },
    {
      name: "description",
      content:
        "Take flight in SKY RUSH, an exciting airplane adventure game! Fly through the skies, avoid obstacles, beat your high score, and become the ruler of the skies."
    },
    {
      name: "keywords",
      content:
        "Sky Rush, Airplane Game, Flying Game, React Game, Arcade Game, Online Airplane Game"
    },
    {
      name: "author",
      content: "Dinuka"
    },
    {
      property: "og:title",
      content: "SKY RUSH | Airplane Adventure Game"
    },
    {
      property: "og:description",
      content:
        "Take Flight. Dodge Danger. Rule the Skies. Play SKY RUSH!"
    },
    {
      property: "og:type",
      content: "website"
    },
  ];
}

export default function Home() {
  return <Welcome />;
}
