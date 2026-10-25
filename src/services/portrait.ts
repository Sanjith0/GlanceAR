import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';

/**
 * Choose or take a profile portrait (the existing enrollment behavior). The
 * portrait is a profile asset for other attendees; it is never used for
 * recognition. Returns null when the person cancels.
 */
export async function pickPortrait(): Promise<string | null> {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Camera permission is off. Enable it in Settings to take your portrait.');
  }
  const result = Platform.OS === 'web' ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 })
    : await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, mediaTypes: ['images'], quality: 0.7 });
  if (result.canceled || !result.assets?.[0]) return null;
  const image = await ImageManipulator.manipulateAsync(result.assets[0].uri, [{ resize: { width: 384 } }],
    { format: ImageManipulator.SaveFormat.JPEG, compress: 0.65, base64: true });
  if (!image.base64) throw new Error('Could not prepare that portrait. Please try again.');
  const value = `data:image/jpeg;base64,${image.base64}`;
  if (value.length > 350000) throw new Error('That portrait is too large. Try a simpler background.');
  return value;
}
