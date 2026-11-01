# Prints the iCloud storage numbers that iCloud for Windows caches in its preferences
# (the same figures its Storage window shows), as one JSON object. Run by server.mjs.
import glob, json, os, plistlib

pattern = os.path.join(os.environ['LOCALAPPDATA'], 'Packages', 'AppleInc.iCloud_*', 'LocalCache', 'Roaming',
                       'Apple Computer', 'Preferences', 'iCloudWinPref.plist')
files = glob.glob(pattern)
if not files:
    print(json.dumps({'error': 'iCloud for Windows storage data not found'}))
    raise SystemExit
pref = plistlib.load(open(files[0], 'rb'))
data = pref['StorageData']
if isinstance(data, bytes):
    data = plistlib.loads(data)
quota = data['storage_data']['quota_info_in_bytes']
print(json.dumps({
    'total': quota['total_quota'],
    'used': quota['total_used'],
    'available': quota['total_available'],
    'media': [{'label': m['display_label'], 'key': m['media_key'], 'bytes': m['usage_in_bytes'], 'color': '#' + m['display_color']}
              for m in data.get('storage_usage_by_media', [])],
    'at': os.path.getmtime(files[0]) * 1000,
}))
