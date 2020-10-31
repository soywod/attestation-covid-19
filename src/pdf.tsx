import React, {useEffect} from "react";
import {BehaviorSubject} from "rxjs";
import {
  Dimensions,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  ToastAndroid,
  TouchableOpacity,
  View,
} from "react-native";
import {NavigationStackScreenComponent} from "react-navigation-stack";
import AsyncStorage from "@react-native-community/async-storage";
import RNFS from "react-native-fs";
import FileViewer from "react-native-file-viewer";
import QRCode from "react-native-qrcode-svg";
import Pdf from "react-native-pdf";
import InAppReview from "react-native-in-app-review";
import useObservable from "@soywod/react-use-observable";
import {DateTime} from "luxon";
import {PDFDocument, StandardFonts, PDFFont} from "pdf-lib";

import {DATE_FMT, TIME_FMT} from "./datetime-picker";
import {Profile, profile$} from "./profile";
import {ReasonKey, reasons, dateStr, timeStr} from "./reasons";
import Loader from "./loader";

export type PDF =
  | {
      isReady: false;
    }
  | {
      isReady: true;
      isGenerated: false;
    }
  | {
      isReady: true;
      isGenerated: true;
      data: string;
    };

export const pdf$ = new BehaviorSubject<PDF>({isReady: false});

AsyncStorage.getItem("pdf").then(data =>
  pdf$.next(
    data
      ? {
          isReady: true,
          isGenerated: true,
          data,
        }
      : {
          isReady: true,
          isGenerated: false,
        },
  ),
);

function idealFontSize(
  font: PDFFont,
  text: string,
  maxWidth: number,
  minSize: number,
  defaultSize: number,
) {
  let currentSize = defaultSize;
  let textWidth = font.widthOfTextAtSize(text, defaultSize);

  while (textWidth > maxWidth && currentSize > minSize) {
    textWidth = font.widthOfTextAtSize(text, --currentSize);
  }

  return textWidth > maxWidth ? null : currentSize;
}

async function generatePdf(profile: Profile, reasons: ReasonKey[], qrcode: string) {
  const {lastName, firstName, dateOfBirth, placeOfBirth, address, city, zip} = profile;
  const now = DateTime.local();
  const readFile = Platform.OS === "android" ? RNFS.readFileAssets : RNFS.readFile;
  const tplPath = Platform.OS === "android" ? "" : RNFS.MainBundlePath + "/";
  const existingPdfBytes = await readFile(tplPath + "template-v3.pdf", "base64");

  const pdfDoc = await PDFDocument.load(existingPdfBytes);
  const page1 = pdfDoc.getPages()[0];

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const drawText = (text: string, x: number, y: number, size = 11) => {
    page1.drawText(text, {x, y, size, font});
  };

  drawText(`${firstName} ${lastName}`, 135, 696);
  drawText(DateTime.fromISO(dateOfBirth).toFormat(DATE_FMT), 135, 674);
  drawText(placeOfBirth, 320, 674);
  drawText(`${address}, ${zip} ${city}`, 135, 652);

  reasons.includes("travail") && drawText("×", 77, 577, 20);
  reasons.includes("achats") && drawText("×", 77, 532, 20);
  reasons.includes("sante") && drawText("×", 77, 476, 20);
  reasons.includes("famille") && drawText("×", 77, 435, 20);
  reasons.includes("handicap") && drawText("×", 77, 394, 20);
  reasons.includes("sport_animaux") && drawText("×", 77, 356, 20);
  reasons.includes("convocation") && drawText("×", 77, 293, 20);
  reasons.includes("missions") && drawText("×", 77, 254, 20);
  reasons.includes("enfants") && drawText("×", 77, 209, 20);

  let locationSize = idealFontSize(font, city, 83, 7, 11);

  if (!locationSize) {
    console.warn(
      "Le nom de la ville risque de ne pas être affiché correctement en raison de sa longueur. " +
        'Essayez d\'utiliser des abréviations ("Saint" en "St." par exemple) quand cela est possible.',
    );
    locationSize = 7;
  }

  drawText(profile.city, 111, 175, locationSize);
  drawText(dateStr, 111, 153);
  drawText(timeStr, 275, 153);
  drawText(`${firstName} ${lastName}`, 130, 119);
  drawText("Date de création:", 464, 110, 7);
  drawText(`${now.toFormat(DATE_FMT)} à ${now.toFormat(TIME_FMT)}`, 455, 104, 7);

  const qrImage = await pdfDoc.embedPng(qrcode);

  page1.drawImage(qrImage, {
    x: page1.getWidth() - 160,
    y: 125,
    width: 80,
    height: 80,
  });

  pdfDoc.addPage();
  const page2 = pdfDoc.getPages()[1];
  page2.drawImage(qrImage, {
    x: 50,
    y: page2.getHeight() - 350,
    width: 300,
    height: 300,
  });

  return await pdfDoc.saveAsBase64();
}

const s = StyleSheet.create({
  container: {
    height: "100%",
    flex: 1,
    justifyContent: "flex-start",
    alignItems: "center",
  },
  qrcodeView: {
    width: 0,
    height: 0,
    flex: 0,
    opacity: 0,
  },
  pdf: {
    flex: 1,
    width: Dimensions.get("window").width,
    height: Dimensions.get("window").height,
  },
  loader: {
    flex: 1,
  },
  headerButton: {padding: 10, marginRight: 5},
});

const PDFScreen: NavigationStackScreenComponent = props => {
  const now = DateTime.local();
  const shouldReset = Boolean((props.navigation.state.params || {}).reset);
  const [profile] = useObservable(profile$, profile$.value);
  const [pdf] = useObservable(pdf$, pdf$.value);
  const qrCodeData = [
    `Cree le: ${now.toFormat(DATE_FMT)} a ${now.toFormat(TIME_FMT)}`,
    `Nom: ${profile.lastName}`,
    `Prenom: ${profile.firstName}`,
    `Naissance: ${DateTime.fromISO(profile.dateOfBirth).toFormat(DATE_FMT)} a ${
      profile.placeOfBirth
    }`,
    `Adresse: ${profile.address} ${profile.zip} ${profile.city}`,
    `Sortie: ${dateStr} a ${timeStr}`,
    `Motifs: ${reasons.join(", ")}`,
  ].join(";\n ");

  function qrCodeDataURLHandler(qrCodeDataURL: string) {
    generatePdf(profile, reasons, qrCodeDataURL.replace(/(\r\n|\n|\r)/gm, "")).then(data => {
      pdf$.next({isReady: true, isGenerated: true, data});
      AsyncStorage.setItem("pdf", data);
    });
  }

  useEffect(() => {
    if (shouldReset) {
      AsyncStorage.removeItem("pdf");
      pdf$.next({isReady: true, isGenerated: false});
    }
  }, [shouldReset]);

  useEffect(() => {
    if (pdf.isReady && pdf.isGenerated) {
      AsyncStorage.getItem("has-review-been-asked").then(hasReviewBeenAsked => {
        if (!hasReviewBeenAsked && InAppReview.isAvailable()) {
          InAppReview.RequestInAppReview();
          AsyncStorage.setItem("has-review-been-asked", "true");
        }
      });
    }
  }, [pdf]);

  return (
    <View style={s.container}>
      {pdf.isReady && pdf.isGenerated ? (
        <Pdf
          activityIndicator={<Loader />}
          source={{uri: "data:application/pdf;base64," + pdf.data}}
          style={s.pdf}
        />
      ) : (
        <View>
          <Loader />
          <View style={s.qrcodeView}>
            <QRCode
              ecl="M"
              getRef={svg => svg && svg.toDataURL(qrCodeDataURLHandler)}
              value={qrCodeData}
            />
          </View>
        </View>
      )}
    </View>
  );
};

PDFScreen.navigationOptions = () => ({
  title: "Attestation",
  headerRight: () => (
    <TouchableOpacity
      activeOpacity={0.5}
      onPress={() => pdf$.value.isReady && pdf$.value.isGenerated && download(pdf$.value.data)}
    >
      <Text style={s.headerButton}>Télécharger</Text>
    </TouchableOpacity>
  ),
});

async function download(data: string) {
  const path = await (() => {
    switch (Platform.OS) {
      case "ios":
        return downloadIOS(data);
      case "android":
        return downloadAndroid(data);
      default:
    }
  })();

  if (path) {
    FileViewer.open(path);
  }
}

async function downloadIOS(data: string) {
  const path = RNFS.DocumentDirectoryPath + "/attestation-deplacement-derogatoire.pdf";
  await RNFS.writeFile(path, data, "base64");
  return path;
}

async function downloadAndroid(data: string) {
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
    );

    if (granted === PermissionsAndroid.RESULTS.GRANTED) {
      const path = RNFS.DownloadDirectoryPath + "/attestation-deplacement-derogatoire.pdf";
      await RNFS.writeFile(path, data, "base64");
      ToastAndroid.show("Attestation téléchargée dans le dossier Download.", ToastAndroid.SHORT);
      return path;
    }
  } catch (err) {
    ToastAndroid.show(err.message, ToastAndroid.SHORT);
  }
}

export default PDFScreen;
