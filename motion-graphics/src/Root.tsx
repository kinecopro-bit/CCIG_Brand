import "./index.css";
import { MyComposition } from "./Composition";
import { NewsletterBackground } from "./NewsletterBackground";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <MyComposition />
      <NewsletterBackground />
    </>
  );
};
