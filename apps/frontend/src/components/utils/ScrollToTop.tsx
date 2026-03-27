import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Global utility component that scrolls the window to the top (0,0)
 * whenever the route pathname changes. This is important in SPA
 * where navigation doesn't naturally reset the scroll position.
 */
export const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    // Scroll to the top of the window
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
