import { Link } from 'react-router';

import { useAppTheme } from '../../styles/hooks.ts';

interface ErrorProps {
  errorCode: number;
}

export const Error = ({ errorCode }: ErrorProps) => {
  const theme = useAppTheme();

  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '24px',
        textAlign: 'center',
      }}
    >
      <h1 css={{ ...theme.typography.h1, color: theme.colors.error.main, margin: 0 }}>{`Error ${errorCode}`}</h1>
      <Link to="/" css={{ color: theme.colors.primary.main }}>
        Back to Homepage
      </Link>
    </div>
  );
};
