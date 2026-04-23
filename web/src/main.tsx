import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import CitizenPage from "./CitizenPage";
import "./styles.css";

const pathname = window.location.pathname.toLowerCase();
const RootComponent = pathname.startsWith("/citizen") ? CitizenPage : App;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>
);
