#!/usr/bin/env python3
from pathlib import Path
import zipfile,subprocess,os
root=Path(__file__).resolve().parents[1]
import argparse
parser=argparse.ArgumentParser(description='Build off-screen Android Replay first-draw regression DEX after compileReleaseJavaWithJavac.')
parser.add_argument('--output', type=Path, required=True)
args=parser.parse_args()
out=args.output.resolve();out.mkdir(parents=True, exist_ok=True)
cache=Path.home()/'.gradle/caches/modules-2/files-2.1'
jars=[]
for name,pattern in [('rn','com.facebook.react/react-android/0.86.0/**/*release.aar'),('replay','com.cloudcare.ft.mobile.sdk.tracker.agent/ft-session-replay/0.1.8/**/*.aar')]:
 f=next(cache.glob(pattern)); p=out/(name+'.jar');p.write_bytes(zipfile.ZipFile(f).read('classes.jar'));jars.append(p)
jars += [next(cache.glob('org.jetbrains.kotlin/kotlin-stdlib/2.2.21/**/*.jar')),next(cache.glob('com.google.code.gson/gson/2.8.9/**/*.jar'))]
classes=root/'node_modules/@cloudcare/react-native-session-replay/android/build/intermediates/javac/release/compileReleaseJavaWithJavac/classes'
android=Path(os.environ['ANDROID_HOME']);lib=android/'platforms/android-36/android.jar'
java=Path(os.environ['JAVA_HOME'])/'bin'
output=out/'fixture';output.mkdir(exist_ok=True)
subprocess.run([str(java/'javac'),'-cp',os.pathsep.join(map(str,[lib,classes,*jars])),'-d',str(output),str(root/'scripts/fixtures/ReplayFirstDrawCheck.java')],check=True)
with zipfile.ZipFile(out/'mapper.jar','w') as z:
 for f in classes.rglob('*.class'):z.write(f,f.relative_to(classes))
env=os.environ.copy();env['JAVA_HOME']=str(java.parent)
subprocess.run([str(android/'build-tools/36.0.0/d8'),'--min-api','26','--lib',str(lib),'--output',str(out),*map(str,jars),str(out/'mapper.jar'),*map(str,output.rglob('*.class'))],check=True,env=env)
