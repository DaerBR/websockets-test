import { useAppTheme } from '../../styles/hooks.ts';

export const Homepage = () => {
  const theme = useAppTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: theme.margins[4],
        padding: theme.padding[6],
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      <h1 css={{ ...theme.typography.h2, color: theme.colors.text.main, margin: 0 }}>Daer React Template</h1>
      <p css={{ ...theme.typography.paragraphM, color: theme.colors.text.subtitle, margin: 0, maxWidth: '480px' }}>
        This is the starting point. Replace this page, wire up your store slices, and start building.
      </p>
      <button id="connect">Connect</button>
    </div>
  );
};
