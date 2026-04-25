const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');

// Coordinates for PDF editing
const PDF_COORDINATES = {
  // Page 1 coordinates
  page1: {
    date: { x: 412, y: 104 }, 
    name: { x: 114, y: 451 },
    pan: { x: 104, y: 474 },
    phone: { x: 120, y: 498 },
    aadhar: { x: 124, y: 518 },
    address: { x: 130, y: 548 },
    packagePrice: { x: 71, y: 457 } // Page 2
  },
  // Page 8 coordinates
  page8: {
    address: { x: 157, y: 238 },
    name: { x: 111, y: 608 },
    date: { x: 135, y: 631 },
    mobile: { x: 115, y: 683 },
    address2: { x: 126, y: 707 },
    pan: { x: 104, y: 731 },
    aadhar: { x: 119, y: 754 }
  }
};

// Test data
const testData = {
  name: "John Doe",
  email: "john.doe@example.com",
  phone: "9876543210",
  pan: "ABCDE1234F",
  aadhar: "123456789012",
  address: "123 Main Street, City, State - 123456",
  packagePrice: "₹50,000"
};

// Generate PDF with user data using coordinates
const generatePdfWithUserData = async (templatePath, userData) => {
  try {
    // Check if template exists
    if (!fs.existsSync(templatePath)) {
      throw new Error('Template PDF not found');
    }
    
    console.log('Template found at:', templatePath);
    
    // Load the PDF template
    const templateBytes = fs.readFileSync(templatePath);
    console.log('Template loaded successfully');
    
    const pdfDoc = await PDFDocument.load(templateBytes);
    console.log('PDF document loaded');
    
    // Embed font
    const font = await pdfDoc.embedFont('Helvetica');
    console.log('Font embedded');
    
    // Get pages
    const pages = pdfDoc.getPages();
    console.log('Number of pages:', pages.length);
    
    // Get current date for date fields
    const currentDate = new Date().toLocaleDateString('en-IN');
    console.log('Current date:', currentDate);
    
    // Define black color
    const blackColor = rgb(0, 0, 0);
    
    // Edit Page 1
    if (pages.length >= 1) {
      const page1 = pages[0];
      console.log('Editing Page 1');
      
      // Add date
      page1.drawText(currentDate, {
        x: PDF_COORDINATES.page1.date.x,
        y: PDF_COORDINATES.page1.date.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add user name
      page1.drawText(userData.name || '', {
        x: PDF_COORDINATES.page1.name.x,
        y: PDF_COORDINATES.page1.name.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add PAN
      page1.drawText(userData.pan || '', {
        x: PDF_COORDINATES.page1.pan.x,
        y: PDF_COORDINATES.page1.pan.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add phone
      page1.drawText(userData.phone || '', {
        x: PDF_COORDINATES.page1.phone.x,
        y: PDF_COORDINATES.page1.phone.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add Aadhar
      page1.drawText(userData.aadhar || '', {
        x: PDF_COORDINATES.page1.aadhar.x,
        y: PDF_COORDINATES.page1.aadhar.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add address
      page1.drawText(userData.address || '', {
        x: PDF_COORDINATES.page1.address.x,
        y: PDF_COORDINATES.page1.address.y,
        size: 12,
        font: font,
        color: blackColor
      });
    }
    
    // Edit Page 2 (for package price)
    if (pages.length >= 2) {
      const page2 = pages[1];
      console.log('Editing Page 2');
      page2.drawText(userData.packagePrice || '', {
        x: PDF_COORDINATES.page1.packagePrice.x,
        y: PDF_COORDINATES.page1.packagePrice.y,
        size: 12,
        font: font,
        color: blackColor
      });
    }
    
    // Edit Page 8
    if (pages.length >= 8) {
      const page8 = pages[7]; // 0-indexed, so page 8 is index 7
      console.log('Editing Page 8');
      
      // Add address
      page8.drawText(userData.address || '', {
        x: PDF_COORDINATES.page8.address.x,
        y: PDF_COORDINATES.page8.address.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add name
      page8.drawText(userData.name || '', {
        x: PDF_COORDINATES.page8.name.x,
        y: PDF_COORDINATES.page8.name.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add date
      page8.drawText(currentDate, {
        x: PDF_COORDINATES.page8.date.x,
        y: PDF_COORDINATES.page8.date.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add mobile
      page8.drawText(userData.phone || '', {
        x: PDF_COORDINATES.page8.mobile.x,
        y: PDF_COORDINATES.page8.mobile.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add address (again)
      page8.drawText(userData.address || '', {
        x: PDF_COORDINATES.page8.address2.x,
        y: PDF_COORDINATES.page8.address2.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add PAN
      page8.drawText(userData.pan || '', {
        x: PDF_COORDINATES.page8.pan.x,
        y: PDF_COORDINATES.page8.pan.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add Aadhar
      page8.drawText(userData.aadhar || '', {
        x: PDF_COORDINATES.page8.aadhar.x,
        y: PDF_COORDINATES.page8.aadhar.y,
        size: 12,
        font: font,
        color: blackColor
      });
    }
    
    // Save the modified PDF
    const pdfBytes = await pdfDoc.save();
    console.log('PDF saved to bytes');
    
    // Generate a unique filename for the user's copy
    const fileName = `test_agreement_${Date.now()}_${userData.name.replace(/\s+/g, '_')}.pdf`;
    const outputPath = path.resolve(__dirname, '../uploads/agreements', fileName);
    
    // Ensure the directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write the PDF to file
    fs.writeFileSync(outputPath, pdfBytes);
    console.log('PDF written to file:', outputPath);
    
    return outputPath;
  } catch (error) {
    console.error('Error generating PDF with user data:', error);
    throw error;
  }
};

// Run the test
async function runTest() {
  try {
    console.log('Starting PDF generation test...');
    
    // Path to the shared template PDF
    const templatePath = path.resolve(__dirname, './templates/franchise_agreement_template.pdf');
    
    // Generate PDF with user data
    const outputPath = await generatePdfWithUserData(templatePath, testData);
    
    console.log('Test completed successfully!');
    console.log('Generated PDF saved at:', outputPath);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  runTest();
}

module.exports = { generatePdfWithUserData };