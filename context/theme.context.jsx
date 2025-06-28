import React, { createContext, useState, useContext, useEffect } from "react";

// Define your custom themes
const LightTheme = {
  dark: false,
  colors: {
    background: "#ffffff",
    text: "#000000",
  },
};

const DarkTheme = {
  dark: true,
  colors: {
    background: "#000000",
    text: "#ffffff",
  },
};

// Create context with default values
const ThemeContext = createContext({
  theme: LightTheme,
  toggleTheme: () => {},
});

// ThemeProvider for wrapping your app
export const ThemeProvider = ({ children }) => {
  const getSystemTheme = () =>
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";

  const [theme, setTheme] = useState(getSystemTheme() === "dark" ? DarkTheme : LightTheme);

  useEffect(() => {
    const loadTheme = async () => {
      const savedTheme = localStorage.getItem("userTheme");
      if (savedTheme) {
        setTheme(savedTheme === "dark" ? DarkTheme : LightTheme);
      } else {
        setTheme(getSystemTheme() === "dark" ? DarkTheme : LightTheme);
      }
    };
    loadTheme();
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === DarkTheme ? LightTheme : DarkTheme;
    setTheme(newTheme);
    localStorage.setItem("userTheme", newTheme.dark ? "dark" : "light");
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Hook to use theme
export const useTheme = () => useContext(ThemeContext);
