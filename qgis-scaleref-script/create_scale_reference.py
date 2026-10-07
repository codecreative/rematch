"""
create_scale_reference.py

QGIS Processing script that creates a two-point "SCALEREF" layer, styled as
pink crosshairs, inset from opposite corners of a given extent.

Purpose: these two points exist purely as a calibration reference, unrelated
to any real map data. Run this once per project, keep the resulting layer
switched on in every SVG/AI export from this project (alongside whatever
data layers you're exporting - rivers, roads, etc.), and never delete it.

Because the two points are fixed at real coordinates, the Rematch
Illustrator extension can later measure the distance between them in a
freshly-imported (still native-scale) export and compare it to the
distance between the same two points in artwork that's already been
scaled/positioned to fit a composition - giving the exact scale
percentage needed to match, without any manual eyeballing.

The output defaults to a small "SCALEREF.geojson" file saved next to the
project, so it's a plain-text asset that persists across sessions and can 
be committed alongside the project. The file is named in all-caps so that 
dragging it into any other project picks up "SCALEREF" as the layer name 
automatically (QGIS names a newly added layer after its file, and the 
extension's name match is case-sensitive).
"""

import os

from qgis.PyQt.QtCore import QCoreApplication, QMetaType
from qgis.core import (
    QgsProcessing,
    QgsProcessingAlgorithm,
    QgsProcessingParameterExtent,
    QgsProcessingParameterCrs,
    QgsProcessingParameterNumber,
    QgsProcessingParameterVectorDestination,
    QgsProcessingException,
    QgsProcessingLayerPostProcessorInterface,
    QgsCoordinateTransform,
    QgsFeature,
    QgsFields,
    QgsField,
    QgsGeometry,
    QgsPointXY,
    QgsWkbTypes,
    QgsMarkerSymbol,
    QgsSingleSymbolRenderer,
    QgsVectorLayer,
    QgsMapLayer,
    QgsProject,
)


def _default_scaleref_path():
    """Defaults the output destination to "SCALEREF.geojson" next to the
    current project, so running this algorithm always persists a small,
    portable file."""
    home = QgsProject.instance().homePath()
    if not home:
        return QgsProcessing.TEMPORARY_OUTPUT
    return os.path.join(home, "SCALEREF.geojson")


class ScaleReferencePostProcessor(QgsProcessingLayerPostProcessorInterface):
    """Styles the SCALEREF output layer as pink crosshairs, and saves that
    styling as a ".qml" sidecar next to the output file so it's picked up
    automatically (no manual restyling) whenever the file is added to any
    project, including ones other than the one it was generated from."""

    instance = None  # keep a reference alive so sip doesn't garbage-collect it

    def postProcessLayer(self, layer, context, feedback):
        if not isinstance(layer, QgsVectorLayer):
            return
        layer.setName("SCALEREF")
        symbol = QgsMarkerSymbol.createSimple(
            {
                "name": "cross",  # crosshair ("+") shape
                "color": "255,0,255,255",  # fuchsia/pink - stands out from real map data
                "outline_color": "255,0,255,255",
                "size": "5",
                "outline_width": "0.6",
            }
        )
        layer.setRenderer(QgsSingleSymbolRenderer(symbol))
        layer.triggerRepaint()

        # Write a same-named .qml next to the output file, e.g.
        # SCALEREF.qml beside SCALEREF.geojson. QGIS auto-applies a sidecar
        # style file like this whenever a layer is added from disk, so the
        # crosshair styling travels with the file
        message, ok = layer.saveDefaultStyle(QgsMapLayer.AllStyleCategories)
        if feedback is not None:
            if ok:
                feedback.pushInfo(message)
            else:
                feedback.reportError(
                    "Could not save SCALEREF.qml style sidecar: " + message,
                    fatalError=False,
                )

    @staticmethod
    def create():
        ScaleReferencePostProcessor.instance = ScaleReferencePostProcessor()
        return ScaleReferencePostProcessor.instance


class CreateScaleReferenceAlgorithm(QgsProcessingAlgorithm):
    EXTENT = "EXTENT"
    CRS = "CRS"
    INSET = "INSET"
    OUTPUT = "OUTPUT"

    def tr(self, string):
        return QCoreApplication.translate("Processing", string)

    def createInstance(self):
        return CreateScaleReferenceAlgorithm()

    def name(self):
        return "create_scale_reference"

    def displayName(self):
        return self.tr("Create scale reference points (SCALEREF)")

    def group(self):
        return self.tr("Rematch Tools")

    def groupId(self):
        return "rematch_tools"

    def shortHelpString(self):
        return self.tr(
            "Creates a two-point 'SCALEREF' layer, styled as pink crosshairs, "
            "inset from opposite corners of the given extent. The extent "
            "field isn't filled in automatically - click the button to use the current map extent.\n\n"
            "Run this once per project, within an area that will always be visible in exports. Keep "
            "this layer switched on in every SVG/AI export from this project "
            "so the Rematch Illustrator extension can measure the distance "
            "between the two points to work out how much a freshly "
            "re-exported layer needs to be rescaled to match artwork that's "
            "already been resized to fit a composition. Never delete this "
            "layer once you've started relying on it.\n\n"
            "Saves to \"SCALEREF.geojson\" next to the project by default - "
            "a small, portable file you can commit alongside the project. A "
            "\"SCALEREF.qml\" style sidecar is written alongside it too, so "
            "the crosshair styling is applied automatically if this file is "
            "later added to a different project."
        )

    def initAlgorithm(self, config=None):
        self.addParameter(
            QgsProcessingParameterExtent(
                self.EXTENT,
                self.tr(
                    "Extent (zoom to an area that will always be visible in exports and click set to current map canvas extent)"
                ),
            )
        )
        self.addParameter(
            QgsProcessingParameterCrs(
                self.CRS,
                self.tr("CRS"),
                defaultValue="ProjectCrs",
            )
        )
        self.addParameter(
            QgsProcessingParameterNumber(
                self.INSET,
                self.tr("Inset from corners (fraction of extent size)"),
                type=QgsProcessingParameterNumber.Type.Double,
                defaultValue=0.1,
                minValue=0.0,
                maxValue=0.49,
            )
        )
        self.addParameter(
            QgsProcessingParameterVectorDestination(
                self.OUTPUT,
                self.tr(
                    "SCALEREF output (defaults to \"SCALEREF.geojson\" next to "
                    "the project - override here if you'd rather use a "
                    "different name, location, or format)"
                ),
                type=QgsProcessing.TypeVectorPoint,
                defaultValue=_default_scaleref_path(),
            )
        )

    def processAlgorithm(self, parameters, context, feedback):
        extent = self.parameterAsExtent(parameters, self.EXTENT, context)
        extent_crs = self.parameterAsExtentCrs(parameters, self.EXTENT, context)
        crs = self.parameterAsCrs(parameters, self.CRS, context)
        inset = self.parameterAsDouble(parameters, self.INSET, context)

        # The extent may have been captured in a different CRS than the one
        # chosen for the output layer (e.g. extent from the map canvas, but
        # output requested in a specific projected CRS) - reproject if needed.
        if extent_crs != crs:
            transform = QgsCoordinateTransform(extent_crs, crs, context.transformContext())
            extent = transform.transformBoundingBox(extent)

        fields = QgsFields()
        fields.append(QgsField("name", QMetaType.Type.QString))

        (sink, dest_id) = self.parameterAsSink(
            parameters, self.OUTPUT, context, fields, QgsWkbTypes.Type.Point, crs
        )
        if sink is None:
            raise QgsProcessingException(self.invalidSinkError(parameters, self.OUTPUT))

        dx = extent.width() * inset
        dy = extent.height() * inset

        # Near top-left and bottom-right corners, inset so they stay clear
        # of the very edge even if the extent is later cropped slightly.
        point_a = QgsPointXY(extent.xMinimum() + dx, extent.yMaximum() - dy)
        point_b = QgsPointXY(extent.xMaximum() - dx, extent.yMinimum() + dy)

        for name, pt in (("SCALEREF_A", point_a), ("SCALEREF_B", point_b)):
            feat = QgsFeature(fields)
            feat.setGeometry(QgsGeometry.fromPointXY(pt))
            feat.setAttributes([name])
            sink.addFeature(feat)

        if context.willLoadLayerOnCompletion(dest_id):
            context.layerToLoadOnCompletionDetails(dest_id).setPostProcessor(
                ScaleReferencePostProcessor.create()
            )

        return {self.OUTPUT: dest_id}
