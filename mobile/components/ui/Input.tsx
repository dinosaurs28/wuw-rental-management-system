import { View, Text, TextInput, StyleSheet, TextInputProps } from 'react-native';
import { Controller, Control, FieldValues, Path } from 'react-hook-form';
import { Colors, Fonts } from '../../constants/colors';

interface InputProps<T extends FieldValues> extends TextInputProps {
  control: Control<T>;
  name: Path<T>;
  label?: string;
  error?: string;
}

export default function Input<T extends FieldValues>({
  control,
  name,
  label,
  error,
  ...inputProps
}: InputProps<T>) {
  return (
    <View style={styles.wrapper}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Controller
        control={control}
        name={name}
        render={({ field: { onChange, onBlur, value } }) => (
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            onChangeText={onChange}
            onBlur={onBlur}
            value={value}
            placeholderTextColor={Colors.ink4}
            {...inputProps}
          />
        )}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 6 },
  label: {
    fontFamily: Fonts.bodySemiBold,
    fontSize: 13,
    color: Colors.ink2,
    letterSpacing: 0.2,
  },
  input: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.hairline,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    fontFamily: Fonts.body,
    fontSize: 15,
    color: Colors.ink,
  },
  inputError: { borderColor: '#e53e3e' },
  error: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: '#e53e3e',
  },
});
