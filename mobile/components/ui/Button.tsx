import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import { Colors, Fonts } from '../../constants/colors';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'dark';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  fullWidth?: boolean;
}

export default function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  fullWidth = true,
}: ButtonProps) {
  const btnStyle = [
    styles.base,
    variant === 'primary' && styles.primary,
    variant === 'secondary' && styles.secondary,
    variant === 'ghost' && styles.ghost,
    variant === 'dark' && styles.dark,
    fullWidth && styles.fullWidth,
    (disabled || loading) && styles.disabled,
    style,
  ];
  const textStyle = [
    styles.label,
    variant === 'primary' && styles.labelPrimary,
    variant === 'secondary' && styles.labelSecondary,
    variant === 'ghost' && styles.labelGhost,
    variant === 'dark' && styles.labelDark,
  ];

  return (
    <TouchableOpacity
      style={btnStyle}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.82}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' || variant === 'dark' ? Colors.white : Colors.orange}
          size="small"
        />
      ) : (
        <Text style={textStyle}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingVertical: 15,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  fullWidth: { width: '100%' },
  primary: { backgroundColor: Colors.orange },
  secondary: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.hairline,
  },
  ghost: { backgroundColor: 'transparent' },
  dark: { backgroundColor: Colors.black },
  disabled: { opacity: 0.5 },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 15,
    letterSpacing: 0.1,
  },
  labelPrimary: { color: Colors.white },
  labelSecondary: { color: Colors.ink },
  labelGhost: { color: Colors.orange },
  labelDark: { color: Colors.white },
});
