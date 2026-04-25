const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require('pdf-lib');

// Coordinates for PDF editing (as per your specification)
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

// Test data with realistic values (without special characters that might cause encoding issues)
const testData = {
  name: "John Doe",
  email: "john.doe@example.com",
  phone: "9876543210",
  pan: "ABCDE1234F",
  aadhar: "123456789012",
  address: "123 Main Street, City, State - 123456",
  packagePrice: "Rs. 50,000" // Changed from ₹ to Rs.
};

// Generate PDF with user data using coordinates
const generatePdfWithUserData = async (templatePath, userData) => {
  try {
    console.log('Starting PDF generation with data:', userData);
    
    // Check if template exists
    if (!fs.existsSync(templatePath)) {
      throw new Error('Template PDF not found at: ' + templatePath);
    }
    
    console.log('Template found at:', templatePath);
    
    // Load the PDF template
    const templateBytes = fs.readFileSync(templatePath);
    console.log('Template loaded successfully, size:', templateBytes.length, 'bytes');
    
    const pdfDoc = await PDFDocument.load(templateBytes);
    console.log('PDF document loaded');
    
    // Embed font
    const font = await pdfDoc.embedFont('Helvetica');
    console.log('Font embedded');
    
    // Get pages
    const pages = pdfDoc.getPages();
    console.log('Number of pages in PDF:', pages.length);
    
    // Get current date for date fields
    const currentDate = new Date().toLocaleDateString('en-IN');
    console.log('Current date for insertion:', currentDate);
    
    // Define black color
    const blackColor = rgb(0, 0, 0);
    
    // Edit Page 1
    if (pages.length >= 1) {
      const page1 = pages[0];
      console.log('Editing Page 1');
      
      // Add date
      console.log('Adding date at coordinates:', PDF_COORDINATES.page1.date);
      page1.drawText(currentDate, {
        x: PDF_COORDINATES.page1.date.x,
        y: PDF_COORDINATES.page1.date.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add user name
      console.log('Adding name at coordinates:', PDF_COORDINATES.page1.name);
      console.log('Name value:', userData.name || '');
      page1.drawText(userData.name || '', {
        x: PDF_COORDINATES.page1.name.x,
        y: PDF_COORDINATES.page1.name.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add PAN
      console.log('Adding PAN at coordinates:', PDF_COORDINATES.page1.pan);
      console.log('PAN value:', userData.pan || '');
      page1.drawText(userData.pan || '', {
        x: PDF_COORDINATES.page1.pan.x,
        y: PDF_COORDINATES.page1.pan.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add phone
      console.log('Adding phone at coordinates:', PDF_COORDINATES.page1.phone);
      console.log('Phone value:', userData.phone || '');
      page1.drawText(userData.phone || '', {
        x: PDF_COORDINATES.page1.phone.x,
        y: PDF_COORDINATES.page1.phone.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add Aadhar
      console.log('Adding Aadhar at coordinates:', PDF_COORDINATES.page1.aadhar);
      console.log('Aadhar value:', userData.aadhar || '');
      page1.drawText(userData.aadhar || '', {
        x: PDF_COORDINATES.page1.aadhar.x,
        y: PDF_COORDINATES.page1.aadhar.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add address
      console.log('Adding address at coordinates:', PDF_COORDINATES.page1.address);
      console.log('Address value:', userData.address || '');
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
      console.log('Adding package price at coordinates:', PDF_COORDINATES.page1.packagePrice);
      console.log('Package price value:', userData.packagePrice || '');
      page2.drawText(userData.packagePrice || '', {
        x: PDF_COORDINATES.page1.packagePrice.x,
        y: PDF_COORDINATES.page1.packagePrice.y,
        size: 12,
        font: font,
        color: blackColor
      });
    } else {
      console.log('Page 2 not found, skipping package price insertion');
    }
    
    // Edit Page 8
    if (pages.length >= 8) {
      const page8 = pages[7]; // 0-indexed, so page 8 is index 7
      console.log('Editing Page 8');
      
      // Add address
      console.log('Adding address at coordinates:', PDF_COORDINATES.page8.address);
      console.log('Address value:', userData.address || '');
      page8.drawText(userData.address || '', {
        x: PDF_COORDINATES.page8.address.x,
        y: PDF_COORDINATES.page8.address.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add name
      console.log('Adding name at coordinates:', PDF_COORDINATES.page8.name);
      console.log('Name value:', userData.name || '');
      page8.drawText(userData.name || '', {
        x: PDF_COORDINATES.page8.name.x,
        y: PDF_COORDINATES.page8.name.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add date
      console.log('Adding date at coordinates:', PDF_COORDINATES.page8.date);
      console.log('Date value:', currentDate);
      page8.drawText(currentDate, {
        x: PDF_COORDINATES.page8.date.x,
        y: PDF_COORDINATES.page8.date.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add mobile
      console.log('Adding mobile at coordinates:', PDF_COORDINATES.page8.mobile);
      console.log('Mobile value:', userData.phone || '');
      page8.drawText(userData.phone || '', {
        x: PDF_COORDINATES.page8.mobile.x,
        y: PDF_COORDINATES.page8.mobile.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add address (again)
      console.log('Adding address2 at coordinates:', PDF_COORDINATES.page8.address2);
      console.log('Address2 value:', userData.address || '');
      page8.drawText(userData.address || '', {
        x: PDF_COORDINATES.page8.address2.x,
        y: PDF_COORDINATES.page8.address2.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add PAN
      console.log('Adding PAN at coordinates:', PDF_COORDINATES.page8.pan);
      console.log('PAN value:', userData.pan || '');
      page8.drawText(userData.pan || '', {
        x: PDF_COORDINATES.page8.pan.x,
        y: PDF_COORDINATES.page8.pan.y,
        size: 12,
        font: font,
        color: blackColor
      });
      
      // Add Aadhar
      console.log('Adding Aadhar at coordinates:', PDF_COORDINATES.page8.aadhar);
      console.log('Aadhar value:', userData.aadhar || '');
      page8.drawText(userData.aadhar || '', {
        x: PDF_COORDINATES.page8.aadhar.x,
        y: PDF_COORDINATES.page8.aadhar.y,
        size: 12,
        font: font,
        color: blackColor
      });
    } else {
      console.log('Page 8 not found, skipping Page 8 insertions');
    }
    
    // Save the modified PDF
    console.log('Saving modified PDF...');
    const pdfBytes = await pdfDoc.save();
    console.log('PDF saved to bytes, size:', pdfBytes.length, 'bytes');
    
    // Generate a unique filename for the user's copy
    const fileName = `debug_agreement_${Date.now()}_${userData.name.replace(/\s+/g, '_')}.pdf`;
    const outputPath = path.resolve(__dirname, '../uploads/agreements', fileName);
    
    // Ensure the directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      console.log('Creating directory:', dir);
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write the PDF to file
    console.log('Writing PDF to file:', outputPath);
    fs.writeFileSync(outputPath, pdfBytes);
    console.log('PDF written to file successfully');
    
    return outputPath;
  } catch (error) {
    console.error('Error generating PDF with user data:', error);
    throw error;
  }
};

// Run the debug test
async function runDebugTest() {
  try {
    console.log('=== Starting PDF Generation Debug Test ===');
    
    // Path to the shared template PDF
    const templatePath = path.resolve(__dirname, './templates/franchise_agreement_template.pdf');
    
    console.log('Using template path:', templatePath);
    
    // Check if template exists
    if (!fs.existsSync(templatePath)) {
      console.error('Template not found at:', templatePath);
      console.log('Available files in templates directory:');
      const templateDir = path.dirname(templatePath);
      if (fs.existsSync(templateDir)) {
        const files = fs.readdirSync(templateDir);
        console.log(files);
      }
      return;
    }
    
    // Generate PDF with user data
    console.log('Calling generatePdfWithUserData...');
    const outputPath = await generatePdfWithUserData(templatePath, testData);
    
    console.log('=== Debug Test Completed Successfully ===');
    console.log('Generated PDF saved at:', outputPath);
  } catch (error) {
    console.error('=== Debug Test Failed ===');
    console.error('Error:', error);
  }
}

// Run the debug test if this script is executed directly
if (require.main === module) {
  runDebugTest();
}

module.exports = { generatePdfWithUserData };